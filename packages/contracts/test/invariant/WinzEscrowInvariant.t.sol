// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";

import {IWinzEscrow} from "../../src/interfaces/IWinzEscrow.sol";
import {WinzEscrow} from "../../src/WinzEscrow.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";
import {EscrowHandler} from "./EscrowHandler.sol";
import {WrongDirectionEscrow} from "../mocks/WrongDirectionEscrow.sol";

/// @notice Invariants of WinzEscrow under random sequences of every action (C-02, EC-2, section 15).
/// @dev Each invariant is recomputed from the escrow's own views and from what the handler recorded
///      when a ticket or a campaign was created; none of them trusts a running total kept by the
///      escrow. The `test_control_*` tests break the state on purpose and check that the matching
///      invariant function fails, so a green invariant run is not a vacuous one.
/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 160
contract WinzEscrowInvariantTest is Test {
    uint64 internal constant START = 1_800_000_000;
    uint256 internal constant BPS = 10_000;

    TestUSDC internal usdc;
    WinzEscrow internal escrow;
    EscrowHandler internal handler;

    address internal relayer = makeAddr("relayer");
    address internal treasury = makeAddr("treasury");
    address internal oracle;

    /// @dev Per-campaign sums over the tickets, indexed by campaign id.
    struct Sums {
        uint256[] refundableAll;
        uint256[] refundableUnpaid;
        uint256[] immediate; // paid - refundable, sent to the merchant at purchase
        uint256[] guaranteeUncharged;
        uint256 paidByTreasury;
    }

    function setUp() public {
        vm.warp(START);
        uint256 oracleKey;
        (oracle, oracleKey) = makeAddrAndKey("oracle");
        usdc = new TestUSDC();
        escrow = new WinzEscrow(address(usdc), relayer, oracle, treasury, makeAddr("owner"));
        handler = new EscrowHandler(escrow, usdc, oracleKey);

        usdc.mint(treasury, 100_000_000e6);
        vm.prank(treasury);
        usdc.approve(address(escrow), type(uint256).max);
        // The handler toggles the blocklist.
        usdc.transferOwnership(address(handler));
        handler.start();

        bytes4[] memory selectors = new bytes4[](24);
        selectors[0] = EscrowHandler.createCampaign.selector;
        selectors[1] = EscrowHandler.topUp.selector;
        selectors[2] = EscrowHandler.buyFor.selector;
        selectors[3] = EscrowHandler.buyDirect.selector;
        selectors[4] = EscrowHandler.setPaused.selector;
        selectors[5] = EscrowHandler.closeSales.selector;
        selectors[6] = EscrowHandler.chargeHedge.selector;
        selectors[7] = EscrowHandler.chargeAll.selector;
        selectors[8] = EscrowHandler.settle.selector;
        selectors[9] = EscrowHandler.closeChargeSettle.selector;
        selectors[10] = EscrowHandler.payMerchant.selector;
        selectors[11] = EscrowHandler.refundBatch.selector;
        selectors[12] = EscrowHandler.release.selector;
        selectors[13] = EscrowHandler.emergencyClaim.selector;
        selectors[14] = EscrowHandler.emergencyReleaseBudget.selector;
        selectors[15] = EscrowHandler.warp.selector;
        selectors[16] = EscrowHandler.warpToEmergency.selector;
        selectors[17] = EscrowHandler.toggleBlocked.selector;
        selectors[18] = EscrowHandler.donate.selector;
        // Listed more than once: buying feeds every other action, and refunds are the path with the
        // most branches.
        selectors[19] = EscrowHandler.buyFor.selector;
        selectors[20] = EscrowHandler.buyFor.selector;
        selectors[21] = EscrowHandler.buyFor.selector;
        selectors[22] = EscrowHandler.buyFor.selector;
        selectors[23] = EscrowHandler.refundBatch.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ----------------------------------------------------------------------------------------------
    // Invariants
    // ----------------------------------------------------------------------------------------------

    /// @notice EC-2. Balance >= unpaid refunds + unspent budget not handed back, with equality once
    ///         the tokens sent straight to the contract are set aside.
    function invariant_solvency() public view {
        uint256 obligations = _obligations();
        uint256 balance = usdc.balanceOf(address(escrow));
        assertGe(balance, obligations, "escrow is insolvent");
        assertEq(balance, obligations + handler.donated(), "escrow balance != obligations + direct transfers");
    }

    /// @notice `lockedRefunds == sum of refundable of unpaid tickets`, per campaign. Once a NO or
    ///         VOID campaign is released the escrow went to the merchant and `lockedRefunds` is 0.
    function invariant_lockedRefundsMatchUnpaidTickets() public view {
        Sums memory s = _sums();
        uint64 count = escrow.campaignCount();
        for (uint64 id = 1; id <= count; ++id) {
            IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
            bool sweptToMerchant = c.released
                && (c.status == IWinzEscrow.Status.SettledNo || c.status == IWinzEscrow.Status.Void);
            if (sweptToMerchant) {
                assertEq(c.lockedRefunds, 0, "lockedRefunds left after a NO/VOID release");
                assertEq(s.refundableUnpaid[id], s.refundableAll[id], "a NO/VOID campaign paid a ticket");
            } else {
                assertEq(c.lockedRefunds, s.refundableUnpaid[id], "lockedRefunds != unpaid refundable");
            }
        }
    }

    /// @notice `hedgeSpent + hedgeReserved <= hedgeBudget`; the reservation is the sum of the
    ///         guarantees of uncharged tickets; what was spent is the sum of the charges.
    function invariant_hedgeAccounting() public view {
        Sums memory s = _sums();
        uint64 count = escrow.campaignCount();
        for (uint64 id = 1; id <= count; ++id) {
            IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
            assertLe(uint256(c.hedgeSpent) + c.hedgeReserved, c.hedgeBudget, "spent + reserved > budget");
            (,,,,, uint256 charged) = handler.campaignGhost(id);
            assertEq(c.hedgeSpent, charged, "hedgeSpent != sum of charges");
            if (c.released && !_isSettled(c.status)) {
                assertEq(c.hedgeReserved, 0, "reservation left after an emergency release");
            } else {
                assertEq(c.hedgeReserved, s.guaranteeUncharged[id], "hedgeReserved != uncharged guarantees");
            }
            assertEq(
                escrow.availableBudget(id), c.hedgeBudget - c.hedgeSpent - c.hedgeReserved, "availableBudget"
            );
        }
    }

    /// @notice R, the price, the instrument and the merchant never change; salesClose only moves
    ///         through closeSales, and only earlier (checked there by the handler).
    function invariant_campaignTermsNeverChange() public view {
        uint64 count = escrow.campaignCount();
        for (uint64 id = 1; id <= count; ++id) {
            IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
            (address merchant, bytes32 instrument, uint128 unitPrice, uint16 refundBps, uint64 salesClose,) =
                handler.campaignGhost(id);
            assertEq(c.refundBps, refundBps, "refundBps changed");
            assertEq(c.unitPrice, unitPrice, "unitPrice changed");
            assertEq(c.merchant, merchant, "merchant changed");
            assertEq(c.instrument, instrument, "instrument changed");
            assertEq(c.salesClose, salesClose, "salesClose changed outside closeSales");
        }
    }

    /// @notice A ticket's amounts and owner never change, and `refundable == paid * R` rounded down.
    function invariant_ticketsNeverChange() public view {
        uint256 count = escrow.ticketCount();
        for (uint256 ticketId = 1; ticketId <= count; ++ticketId) {
            IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
            (uint64 campaignId, address buyer, uint128 paid, uint128 refundable, uint128 maxHedgeCost,) =
                handler.ticketGhost(ticketId);
            assertEq(t.campaignId, campaignId, "ticket campaign changed");
            assertEq(t.buyer, buyer, "ticket buyer changed");
            assertEq(t.paid, paid, "ticket paid changed");
            assertEq(t.refundable, refundable, "ticket refundable changed");
            assertEq(t.maxHedgeCost, maxHedgeCost, "ticket guarantee changed");
            assertEq(
                t.refundable, uint256(t.paid) * escrow.getCampaign(campaignId).refundBps / BPS, "R x paid"
            );
        }
    }

    /// @notice Status rules: a settled campaign is past salesClose with no reservation; an unsettled
    ///         one owes nothing through payMerchant, and can only be released by the emergency exit.
    function invariant_statusRules() public view {
        uint64 count = escrow.campaignCount();
        for (uint64 id = 1; id <= count; ++id) {
            IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
            if (_isSettled(c.status)) {
                assertGe(block.timestamp, c.salesClose, "settled before salesClose");
                assertEq(c.hedgeReserved, 0, "settled with an open reservation");
            } else {
                assertEq(c.merchantDue, 0, "merchantDue before settlement");
                if (c.released) {
                    assertGe(
                        block.timestamp,
                        uint256(c.salesClose) + escrow.EMERGENCY_DELAY(),
                        "released too early"
                    );
                }
            }
        }
    }

    /// @notice No money leaves without a rule, buyers' side: a buyer holds exactly the refundable
    ///         amounts of its paid-out tickets (the handler funds direct purchases to the cent).
    function invariant_buyersHoldExactlyTheirRefunds() public view {
        uint256 buyerCount = handler.buyerCount();
        uint256 ticketCount = escrow.ticketCount();
        for (uint256 i; i < buyerCount; ++i) {
            address buyer = handler.buyers(i);
            uint256 expected;
            for (uint256 ticketId = 1; ticketId <= ticketCount; ++ticketId) {
                IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
                if (t.buyer == buyer && t.paidOut) expected += t.refundable;
            }
            assertEq(usdc.balanceOf(buyer), expected, "buyer balance != refunds received");
        }
    }

    /// @notice No money leaves without a rule, merchants' side: a merchant holds exactly its
    ///         non-refundable share, plus what release and payMerchant are specified to pay.
    function invariant_merchantsHoldExactlyWhatTheRulesGive() public view {
        Sums memory s = _sums();
        uint256 merchantCount = handler.merchantCount();
        uint64 count = escrow.campaignCount();
        for (uint256 i; i < merchantCount; ++i) {
            address merchant = handler.merchants(i);
            uint256 expected;
            for (uint64 id = 1; id <= count; ++id) {
                IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
                if (c.merchant != merchant) continue;
                expected += s.immediate[id];
                if (c.released) {
                    expected += c.hedgeBudget - c.hedgeSpent;
                    if (c.status == IWinzEscrow.Status.SettledNo || c.status == IWinzEscrow.Status.Void) {
                        expected += s.refundableAll[id];
                    }
                }
                expected += _duePaid(c, s.refundableAll[id]);
            }
            assertEq(usdc.balanceOf(merchant), expected, "merchant balance != what the rules give");
        }
    }

    /// @notice The treasury only pays budgets, purchases and merchant dues, and only receives hedge
    ///         charges.
    function invariant_treasuryFlows() public view {
        Sums memory s = _sums();
        uint64 count = escrow.campaignCount();
        uint256 out = s.paidByTreasury;
        uint256 back;
        uint256 duePaid;
        for (uint64 id = 1; id <= count; ++id) {
            IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
            out += c.hedgeBudget;
            back += c.hedgeSpent;
            duePaid += _duePaid(c, s.refundableAll[id]);
        }
        assertEq(duePaid, handler.merchantPaid(), "merchant dues paid");
        assertEq(usdc.balanceOf(treasury), handler.treasuryStart() - out - duePaid + back, "treasury balance");
    }

    /// @notice Post-conditions checked by the handler after each successful action.
    function invariant_noHandlerViolation() public view {
        assertEq(handler.violation(), "", "handler post-condition");
    }

    /// @notice Not an invariant: prints how often each action went through in the last run.
    function invariant_callSummary() public view {
        string[19] memory actions = [
            "createCampaign",
            "topUp",
            "buyFor",
            "buyDirect",
            "setPaused",
            "closeSales",
            "chargeHedge",
            "chargeAll",
            "settle",
            "closeChargeSettle",
            "payMerchant",
            "refundBatch",
            "release",
            "emergencyClaim",
            "emergencyReleaseBudget",
            "warp",
            "warpToEmergency",
            "toggleBlocked",
            "donate"
        ];
        for (uint256 i; i < actions.length; ++i) {
            console2.log(actions[i], handler.callCount(actions[i]));
        }
        console2.log("campaigns", escrow.campaignCount());
        console2.log("tickets", escrow.ticketCount());
    }

    // ----------------------------------------------------------------------------------------------
    // Controls: the handler reaches every action, and each invariant can fail
    // ----------------------------------------------------------------------------------------------

    /// @dev A scripted sequence through the handler: every action goes through at least once, and
    ///      every invariant holds on the resulting state (settled YES, NO, VOID and emergency).
    function test_control_handlerReachesEveryAction() public {
        _scriptedSequence();

        string[19] memory actions = [
            "createCampaign",
            "topUp",
            "buyFor",
            "buyDirect",
            "setPaused",
            "closeSales",
            "chargeHedge",
            "chargeAll",
            "settle",
            "closeChargeSettle",
            "payMerchant",
            "refundBatch",
            "release",
            "emergencyClaim",
            "emergencyReleaseBudget",
            "warp",
            "warpToEmergency",
            "toggleBlocked",
            "donate"
        ];
        for (uint256 i; i < actions.length; ++i) {
            assertGt(handler.callCount(actions[i]), 0, actions[i]);
        }
        _allInvariants();
    }

    function test_control_solvencyFailsWhenOneMicroDollarIsMissing() public {
        _scriptedSequence();
        invariant_solvency();

        vm.prank(address(escrow));
        usdc.transfer(makeAddr("thief"), 1);

        vm.expectRevert();
        this.invariant_solvency();
    }

    function test_control_lockedRefundsFailsWhenTheCounterDrifts() public {
        _scriptedSequence();
        invariant_lockedRefundsMatchUnpaidTickets();

        // Campaign 5 is live with one unpaid ticket: lower its lockedRefunds by one micro-dollar.
        IWinzEscrow.Campaign memory c = escrow.getCampaign(5);
        assertGt(c.lockedRefunds, 0);
        bytes32 slot = _slotHolding(5, (uint256(c.lockedRefunds) << 128) | c.hedgeSpent);
        vm.store(address(escrow), slot, bytes32((uint256(c.lockedRefunds - 1) << 128) | c.hedgeSpent));
        assertEq(escrow.getCampaign(5).lockedRefunds, c.lockedRefunds - 1, "tampering landed");

        vm.expectRevert();
        this.invariant_lockedRefundsMatchUnpaidTickets();
        vm.expectRevert();
        this.invariant_solvency();
    }

    function test_control_hedgeAccountingFailsWhenSpentDrifts() public {
        _scriptedSequence();
        invariant_hedgeAccounting();

        IWinzEscrow.Campaign memory c = escrow.getCampaign(5);
        bytes32 slot = _slotHolding(5, (uint256(c.lockedRefunds) << 128) | c.hedgeSpent);
        vm.store(address(escrow), slot, bytes32((uint256(c.lockedRefunds) << 128) | (c.hedgeSpent + 1)));
        assertEq(escrow.getCampaign(5).hedgeSpent, c.hedgeSpent + 1, "tampering landed");

        vm.expectRevert();
        this.invariant_hedgeAccounting();
    }

    function test_control_termsFailWhenRefundBpsChanges() public {
        _scriptedSequence();
        invariant_campaignTermsNeverChange();

        // salesClose (8 bytes), unitPrice (16) and refundBps (2) share one slot, in that order.
        IWinzEscrow.Campaign memory c = escrow.getCampaign(5);
        uint256 word = uint256(c.salesClose) | (uint256(c.unitPrice) << 64) | (uint256(c.refundBps) << 192);
        bytes32 slot = _slotHolding(5, word);
        uint16 lowered = c.refundBps - 1;
        vm.store(
            address(escrow), slot, bytes32((word & ~(uint256(0xffff) << 192)) | (uint256(lowered) << 192))
        );
        assertEq(escrow.getCampaign(5).refundBps, lowered, "tampering landed");

        vm.expectRevert();
        this.invariant_campaignTermsNeverChange();
    }

    function test_control_buyerAndMerchantModelsFailOnAStrayPayment() public {
        _scriptedSequence();
        invariant_buyersHoldExactlyTheirRefunds();
        invariant_merchantsHoldExactlyWhatTheRulesGive();
        invariant_treasuryFlows();

        usdc.mint(handler.buyers(0), 1);
        vm.expectRevert();
        this.invariant_buyersHoldExactlyTheirRefunds();

        usdc.mint(handler.merchants(0), 1);
        vm.expectRevert();
        this.invariant_merchantsHoldExactlyWhatTheRulesGive();

        vm.prank(treasury);
        usdc.transfer(makeAddr("elsewhere"), 1);
        vm.expectRevert();
        this.invariant_treasuryFlows();
    }

    /// @dev A money movement in the wrong direction must land in `violation`. Before the handler's
    ///      deltas were direction-safe, `escrowBefore - escrowAfter` panicked instead, and with
    ///      fail_on_revert off the invariant campaign silently dropped the call.
    function test_control_handlerRecordsAWrongDirectionMovement() public {
        _scriptedSequence();
        assertEq(bytes(handler.violation()).length, 0, "clean before");
        assertEq(uint8(escrow.getCampaign(1).status), uint8(IWinzEscrow.Status.SettledYes));

        // Same constructor arguments as setUp, so the delegated code reads the same immutables.
        WinzEscrow impl = new WinzEscrow(address(usdc), relayer, oracle, treasury, makeAddr("owner"));
        vm.etch(
            address(escrow), address(new WrongDirectionEscrow(address(impl), address(usdc), treasury)).code
        );

        uint256 calls = handler.callCount("refundBatch");
        handler.refundBatch(_exact(0), type(uint256).max, address(this));
        assertEq(handler.callCount("refundBatch"), calls + 1, "the handler call went through");
        assertEq(handler.violation(), "refundBatch: escrow outflow != lockedRefunds decrease");
    }

    // ----------------------------------------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------------------------------------

    function _allInvariants() internal view {
        invariant_solvency();
        invariant_lockedRefundsMatchUnpaidTickets();
        invariant_hedgeAccounting();
        invariant_campaignTermsNeverChange();
        invariant_ticketsNeverChange();
        invariant_statusRules();
        invariant_buyersHoldExactlyTheirRefunds();
        invariant_merchantsHoldExactlyWhatTheRulesGive();
        invariant_treasuryFlows();
        invariant_noHandlerViolation();
    }

    /// @dev Seed that makes the handler take exactly the `index`-th campaign or ticket (0-based)
    ///      instead of looking for one that fits the action.
    function _exact(uint256 index) internal pure returns (uint256) {
        return (uint256(3) << 128) | index;
    }

    /// @dev Campaigns 1 to 4 end settled YES, NO, VOID and emergency-released; campaign 5 stays live
    ///      with one unpaid, charged ticket.
    function _scriptedSequence() internal {
        for (uint256 i; i < 4; ++i) {
            handler.createCampaign(i, 20e6, i % 2 == 0 ? 10_000 : 2_500, 1 days, 100e6);
        }
        handler.topUp(_exact(0), 50e6);
        handler.donate(3e6);

        // Tickets 1..8: two per campaign, one through the treasury and one paid by the buyer.
        for (uint256 i; i < 4; ++i) {
            handler.buyFor(_exact(i), i, 1, 5e6);
            handler.buyDirect(_exact(i), i + 1, 2, 3e6);
        }
        handler.setPaused(1, true);
        handler.setPaused(1, false);
        handler.chargeHedge(_exact(0), 2e6); // ticket 1, campaign 1
        handler.warp(1 hours);
        handler.closeSales(_exact(0));

        // Campaign 1: YES, with one blocked buyer in the first refund batch.
        handler.chargeAll(_exact(0), 11);
        handler.settle(_exact(0), 0);
        handler.toggleBlocked(0);
        handler.refundBatch(_exact(0), type(uint256).max, address(this));
        assertFalse(escrow.getTicket(1).paidOut, "blocked buyer: ticket 1 still owed");
        assertTrue(escrow.getTicket(2).paidOut, "ticket 2 paid in the same batch");
        handler.toggleBlocked(0);
        handler.refundBatch(_exact(0), type(uint256).max, address(this));
        handler.payMerchant(_exact(0), address(this));
        handler.release(_exact(0), address(this));

        // Campaign 2: NO. Campaign 3: VOID.
        handler.closeChargeSettle(_exact(1), 12, 1);
        handler.release(_exact(1), address(this));
        handler.closeChargeSettle(_exact(2), 13, 2);
        handler.payMerchant(_exact(2), address(this));
        handler.release(_exact(2), address(this));

        // Campaign 4: never settled, emergency exits.
        handler.warpToEmergency(_exact(3));
        handler.emergencyClaim(_exact(6), address(this)); // ticket 7
        handler.emergencyReleaseBudget(_exact(3), address(this));
        handler.emergencyClaim(_exact(7), address(this)); // ticket 8

        // Campaign 5: live, one ticket, charged.
        handler.createCampaign(1, 20e6, 5_000, 1 days, 100e6);
        handler.buyFor(_exact(4), 2, 1, 5e6); // ticket 9
        handler.chargeHedge(_exact(8), 1e6);

        assertEq(escrow.campaignCount(), 5);
        assertEq(escrow.ticketCount(), 9);
        assertEq(uint8(escrow.getCampaign(1).status), uint8(IWinzEscrow.Status.SettledYes));
        assertEq(uint8(escrow.getCampaign(2).status), uint8(IWinzEscrow.Status.SettledNo));
        assertEq(uint8(escrow.getCampaign(3).status), uint8(IWinzEscrow.Status.Void));
        assertEq(uint8(escrow.getCampaign(4).status), uint8(IWinzEscrow.Status.Live));
        assertTrue(escrow.getCampaign(4).released);
        assertEq(uint8(escrow.getCampaign(5).status), uint8(IWinzEscrow.Status.Live));
        assertEq(escrow.getCampaign(5).hedgeSpent, 1e6);
        assertEq(escrow.getCampaign(5).lockedRefunds, 10e6);
    }

    function _obligations() internal view returns (uint256 total) {
        uint64 count = escrow.campaignCount();
        for (uint64 id = 1; id <= count; ++id) {
            IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
            total += c.lockedRefunds;
            if (!c.released) total += c.hedgeBudget - c.hedgeSpent;
        }
    }

    function _sums() internal view returns (Sums memory s) {
        uint256 size = uint256(escrow.campaignCount()) + 1;
        s.refundableAll = new uint256[](size);
        s.refundableUnpaid = new uint256[](size);
        s.immediate = new uint256[](size);
        s.guaranteeUncharged = new uint256[](size);
        uint256 count = escrow.ticketCount();
        for (uint256 ticketId = 1; ticketId <= count; ++ticketId) {
            IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
            s.refundableAll[t.campaignId] += t.refundable;
            s.immediate[t.campaignId] += t.paid - t.refundable;
            if (!t.paidOut) s.refundableUnpaid[t.campaignId] += t.refundable;
            if (!t.hedgeCharged) s.guaranteeUncharged[t.campaignId] += t.maxHedgeCost;
            (,,,,, bool viaTreasury) = handler.ticketGhost(ticketId);
            if (viaTreasury) s.paidByTreasury += t.paid;
        }
    }

    /// @dev What payMerchant has paid so far for a campaign: the amount settlement made due (YES:
    ///      the whole exposure; VOID: the hedge spent) minus what is still due.
    function _duePaid(IWinzEscrow.Campaign memory c, uint256 exposure) internal pure returns (uint256) {
        uint256 dueAtSettlement;
        if (c.status == IWinzEscrow.Status.SettledYes) dueAtSettlement = exposure;
        else if (c.status == IWinzEscrow.Status.Void) dueAtSettlement = c.hedgeSpent;
        assertTrue(
            c.merchantDue == 0 || c.merchantDue == dueAtSettlement, "merchantDue is neither 0 nor the due"
        );
        return dueAtSettlement - c.merchantDue;
    }

    function _isSettled(IWinzEscrow.Status status) internal pure returns (bool) {
        return status != IWinzEscrow.Status.Live && status != IWinzEscrow.Status.Paused;
    }

    /// @dev Finds, among the storage slots `getCampaign(id)` reads, the one holding `word`.
    function _slotHolding(uint64 id, uint256 word) internal returns (bytes32) {
        vm.record();
        escrow.getCampaign(id);
        (bytes32[] memory reads,) = vm.accesses(address(escrow));
        for (uint256 i; i < reads.length; ++i) {
            if (uint256(vm.load(address(escrow), reads[i])) == word) return reads[i];
        }
        revert("slot not found");
    }
}
