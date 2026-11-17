// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @notice settle, payMerchant, refundBatch and release (EC-3, EC-7, ST-2, ST-3, ST-4).
contract WinzEscrowSettlementTest is EscrowFixture {
    uint64 internal id;
    uint256 internal tMaya;
    uint256 internal tLiam;
    uint256 internal tZoe;

    /// @dev Joe: 20 USDC, 100 % back, 1 000 USDC budget. Three tickets (1, 2 and 1 units), hedge
    ///      guarantees of 3, 6 and 3, charged 2, 5 and 3: hedgeSpent = 10, lockedRefunds = 80.
    function setUp() public override {
        super.setUp();
        id = _createJoe();
        tMaya = _buyFor(id, maya, 1, 3 * ONE);
        tLiam = _buyFor(id, liam, 2, 6 * ONE);
        tZoe = _buyFor(id, zoe, 1, 3 * ONE);
    }

    function _chargeAll() internal {
        vm.prank(oracle);
        escrow.chargeHedge(_ids(tMaya, tLiam, tZoe), _amounts(2 * ONE, 5 * ONE, 3 * ONE));
    }

    function _settled(IWinzEscrow.Outcome outcome) internal {
        _chargeAll();
        _closeAndSettle(id, outcome);
    }

    // ----------------------------------------------------------------------------------------------
    // settle
    // ----------------------------------------------------------------------------------------------

    function test_settle_yes_owesTheExposureToTheMerchant() public {
        _chargeAll();
        vm.warp(salesClose);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignSettled(id, IWinzEscrow.Outcome.Yes, 80 * ONE);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.Yes);

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(uint8(c.status), uint8(IWinzEscrow.Status.SettledYes));
        assertEq(c.merchantDue, 80 * ONE, "YES: lockedRefunds at that time");
        assertEq(c.lockedRefunds, 80 * ONE, "settling moves no money");
        assertFalse(c.released);
        _assertSolvent();
    }

    function test_settle_no_owesNothing() public {
        _chargeAll();
        vm.warp(salesClose);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignSettled(id, IWinzEscrow.Outcome.No, 0);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.No);

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(uint8(c.status), uint8(IWinzEscrow.Status.SettledNo));
        assertEq(c.merchantDue, 0);
    }

    function test_settle_void_owesTheHedgeSpent() public {
        _chargeAll();
        vm.warp(salesClose);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignSettled(id, IWinzEscrow.Outcome.Void, 10 * ONE);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.Void);

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(uint8(c.status), uint8(IWinzEscrow.Status.Void));
        assertEq(c.merchantDue, 10 * ONE, "VOID: hedgeSpent");
    }

    function test_settle_worksOnAPausedCampaign_andOnOneWithoutTickets() public {
        uint64 paused = _create(ana, ONE, 10_000, 5 * ONE);
        uint64 empty = _create(ana, ONE, 10_000, 5 * ONE);
        vm.prank(relayer);
        escrow.setPaused(paused, true);

        vm.warp(salesClose);
        _settle(paused, IWinzEscrow.Outcome.Yes);
        _settle(empty, IWinzEscrow.Outcome.Void);
        assertEq(uint8(escrow.getCampaign(paused).status), uint8(IWinzEscrow.Status.SettledYes));
        assertEq(uint8(escrow.getCampaign(empty).status), uint8(IWinzEscrow.Status.Void));
        assertEq(escrow.getCampaign(paused).merchantDue, 0);
        assertEq(escrow.getCampaign(empty).merchantDue, 0);
    }

    function test_settle_revertsForNonOracle() public {
        _chargeAll();
        vm.warp(salesClose);
        address[5] memory callers = [owner, relayer, treasury, joe, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IWinzEscrow.Unauthorized.selector);
            vm.prank(callers[i]);
            escrow.settle(id, IWinzEscrow.Outcome.Yes);
        }
        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.Live));
    }

    function test_settle_revertsForUnknownCampaign() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        vm.prank(oracle);
        escrow.settle(2, IWinzEscrow.Outcome.Yes);
    }

    function test_settle_revertsBeforeSalesClose_passesAtSalesClose() public {
        _chargeAll();

        vm.warp(salesClose - 1);
        vm.expectRevert(IWinzEscrow.SalesStillOpen.selector);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.Yes);

        vm.warp(salesClose);
        _settle(id, IWinzEscrow.Outcome.Yes);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.SettledYes));
    }

    function test_settle_revertsWithAnOpenReservation() public {
        // Two of three tickets charged: 3 USDC still reserved for the third.
        vm.prank(oracle);
        escrow.chargeHedge(_ids(tMaya, tLiam), _amounts(2 * ONE, 5 * ONE));
        vm.warp(salesClose);
        assertEq(escrow.getCampaign(id).hedgeReserved, 3 * ONE);

        vm.expectRevert(IWinzEscrow.HedgeNotFinalized.selector);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.Yes);

        // Positive control: once the last ticket is charged (even for zero), settlement passes.
        _charge(tZoe, 0);
        _settle(id, IWinzEscrow.Outcome.Yes);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.SettledYes));
    }

    function test_settle_twiceReverts_whateverTheOutcome() public {
        _settled(IWinzEscrow.Outcome.No);

        IWinzEscrow.Outcome[3] memory outcomes =
            [IWinzEscrow.Outcome.No, IWinzEscrow.Outcome.Yes, IWinzEscrow.Outcome.Void];
        for (uint256 i; i < outcomes.length; ++i) {
            vm.expectRevert(IWinzEscrow.AlreadySettled.selector);
            vm.prank(oracle);
            escrow.settle(id, outcomes[i]);
        }

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(uint8(c.status), uint8(IWinzEscrow.Status.SettledNo), "the first outcome stands");
        assertEq(c.merchantDue, 0);
    }

    function test_settle_revertsOnceTheEmergencyWindowIsOpen() public {
        _chargeAll();

        // Positive control on a twin campaign: the last second before the window still settles.
        uint64 twin = _create(ana, ONE, 10_000, 0);
        vm.warp(salesClose + DELAY - 1);
        _settle(twin, IWinzEscrow.Outcome.Yes);

        vm.warp(salesClose + DELAY);
        vm.expectRevert(IWinzEscrow.EmergencyActive.selector);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.Yes);

        vm.warp(salesClose + 365 days);
        vm.expectRevert(IWinzEscrow.EmergencyActive.selector);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.No);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.Live));
    }

    // ----------------------------------------------------------------------------------------------
    // payMerchant
    // ----------------------------------------------------------------------------------------------

    function test_payMerchant_yes_paysTheExposureFromTheTreasury() public {
        _settled(IWinzEscrow.Outcome.Yes);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.MerchantPaid(id, 80 * ONE);
        vm.prank(stranger);
        escrow.payMerchant(id);

        assertEq(usdc.balanceOf(joe), 80 * ONE);
        assertEq(usdc.balanceOf(treasury), treasuryBefore - 80 * ONE, "paid by the treasury");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore, "not by the escrow");
        assertEq(usdc.balanceOf(stranger), 0, "the caller gets nothing");
        assertEq(escrow.getCampaign(id).merchantDue, 0);
        _assertSolvent();
    }

    function test_payMerchant_secondCallReverts() public {
        _settled(IWinzEscrow.Outcome.Yes);
        escrow.payMerchant(id);

        vm.expectRevert(IWinzEscrow.NothingDue.selector);
        escrow.payMerchant(id);
        assertEq(usdc.balanceOf(joe), 80 * ONE);
    }

    function test_payMerchant_void_paysBackTheHedgeSpent() public {
        _settled(IWinzEscrow.Outcome.Void);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.MerchantPaid(id, 10 * ONE);
        escrow.payMerchant(id);

        assertEq(usdc.balanceOf(joe), 10 * ONE);
        assertEq(usdc.balanceOf(treasury), treasuryBefore - 10 * ONE);
        _assertSolvent();
    }

    function test_payMerchant_no_nothingDue() public {
        _settled(IWinzEscrow.Outcome.No);
        vm.expectRevert(IWinzEscrow.NothingDue.selector);
        escrow.payMerchant(id);
        assertEq(usdc.balanceOf(joe), 0);
    }

    function test_payMerchant_revertsBeforeSettlement() public {
        _chargeAll();
        vm.warp(salesClose);
        vm.expectRevert(IWinzEscrow.NotSettled.selector);
        escrow.payMerchant(id);
    }

    function test_payMerchant_revertsForUnknownCampaign() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        escrow.payMerchant(2);
    }

    /// @dev Section 8: an empty treasury blocks the merchant payment only, never refunds or release.
    function test_emptyTreasury_blocksOnlyPayMerchant() public {
        _settled(IWinzEscrow.Outcome.Yes);
        uint256 treasuryBalance = usdc.balanceOf(treasury);
        vm.prank(treasury);
        usdc.transfer(stranger, treasuryBalance);

        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, treasury, 0, 80 * ONE)
        );
        escrow.payMerchant(id);
        assertEq(escrow.getCampaign(id).merchantDue, 80 * ONE, "still owed");

        escrow.refundBatch(id, _ids(tMaya, tLiam, tZoe));
        assertEq(usdc.balanceOf(maya), 20 * ONE);
        assertEq(usdc.balanceOf(liam), 40 * ONE);
        assertEq(usdc.balanceOf(zoe), 20 * ONE);

        escrow.release(id);
        assertEq(usdc.balanceOf(joe), 990 * ONE, "unspent budget");

        // Once the treasury is funded again, the merchant is paid.
        usdc.mint(treasury, 80 * ONE);
        escrow.payMerchant(id);
        assertEq(usdc.balanceOf(joe), 1_070 * ONE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // refundBatch
    // ----------------------------------------------------------------------------------------------

    function test_refundBatch_paysEveryBuyerFromTheEscrow() public {
        _settled(IWinzEscrow.Outcome.Yes);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketRefunded(tMaya, id, maya, 20 * ONE);
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketRefunded(tLiam, id, liam, 40 * ONE);
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketRefunded(tZoe, id, zoe, 20 * ONE);
        vm.prank(stranger);
        escrow.refundBatch(id, _ids(tMaya, tLiam, tZoe));

        assertEq(usdc.balanceOf(maya), 20 * ONE);
        assertEq(usdc.balanceOf(liam), 40 * ONE);
        assertEq(usdc.balanceOf(zoe), 20 * ONE);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(treasury), treasuryBefore, "refunds never touch the treasury");
        assertEq(escrow.getCampaign(id).lockedRefunds, 0);
        assertTrue(escrow.getTicket(tMaya).paidOut);
        assertTrue(escrow.getTicket(tLiam).paidOut);
        assertTrue(escrow.getTicket(tZoe).paidOut);
        _assertSolvent();
    }

    function test_refundBatch_partialRefundRate_paysOnlyTheRefundablePart() public {
        uint64 half = _create(ana, 20 * ONE, 5_000, 0);
        uint256 ticketId = _buyFor(half, maya, 1, 0);
        _closeAndSettle(half, IWinzEscrow.Outcome.Yes);

        escrow.refundBatch(half, _ids(ticketId));
        assertEq(usdc.balanceOf(maya), 10 * ONE, "R x paid, not paid");
        assertEq(escrow.getCampaign(half).lockedRefunds, 0);
        _assertSolvent();
    }

    function test_refundBatch_skipsPaidUnknownAndForeignTickets() public {
        uint64 other = _create(ana, 5 * ONE, 10_000, 0);
        uint256 foreign = _buyFor(other, zoe, 1, 0);
        _settled(IWinzEscrow.Outcome.Yes);
        _settle(other, IWinzEscrow.Outcome.Yes);

        escrow.refundBatch(id, _ids(tMaya));
        assertEq(usdc.balanceOf(maya), 20 * ONE);

        // Already paid (twice in the same batch too), unknown ids, a ticket of another YES campaign.
        uint256[] memory ids = new uint256[](6);
        ids[0] = tMaya;
        ids[1] = 0;
        ids[2] = 999;
        ids[3] = foreign;
        ids[4] = tLiam;
        ids[5] = tLiam;
        vm.recordLogs();
        escrow.refundBatch(id, ids);
        // One refund only: a token Transfer and a TicketRefunded.
        assertEq(vm.getRecordedLogs().length, 2, "skipped items are silent");

        assertEq(usdc.balanceOf(maya), 20 * ONE, "not paid twice");
        assertEq(usdc.balanceOf(liam), 40 * ONE, "paid once");
        assertEq(usdc.balanceOf(zoe), 0, "the foreign ticket was not paid through this campaign");
        assertFalse(escrow.getTicket(foreign).paidOut);
        assertEq(escrow.getCampaign(id).lockedRefunds, 20 * ONE, "zoe's ticket of this campaign is left");
        assertEq(escrow.getCampaign(other).lockedRefunds, 5 * ONE);

        // Positive control: the foreign ticket is refunded through its own campaign.
        escrow.refundBatch(other, _ids(foreign));
        assertEq(usdc.balanceOf(zoe), 5 * ONE);
        _assertSolvent();
    }

    function test_refundBatch_repeatedBatchChangesNothing() public {
        _settled(IWinzEscrow.Outcome.Yes);
        escrow.refundBatch(id, _ids(tMaya, tLiam, tZoe));
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.recordLogs();
        escrow.refundBatch(id, _ids(tMaya, tLiam, tZoe));
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore);
        assertEq(usdc.balanceOf(liam), 40 * ONE);
    }

    function test_refundBatch_emptyBatchIsANoOp() public {
        _settled(IWinzEscrow.Outcome.Yes);
        escrow.refundBatch(id, new uint256[](0));
        assertEq(escrow.getCampaign(id).lockedRefunds, 80 * ONE);
    }

    /// @dev EC-7: a blocklisted buyer does not cancel the batch; the ticket stays owed.
    function test_refundBatch_blockedBuyerDoesNotBlockTheBatch() public {
        _settled(IWinzEscrow.Outcome.Yes);
        usdc.setBlocked(liam, true);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketRefunded(tMaya, id, maya, 20 * ONE);
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.RefundFailed(tLiam, id);
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketRefunded(tZoe, id, zoe, 20 * ONE);
        escrow.refundBatch(id, _ids(tMaya, tLiam, tZoe));

        assertEq(usdc.balanceOf(maya), 20 * ONE, "paid before the failure");
        assertEq(usdc.balanceOf(zoe), 20 * ONE, "paid after the failure");
        assertEq(usdc.balanceOf(liam), 0);
        assertFalse(escrow.getTicket(tLiam).paidOut, "still owed");
        assertEq(escrow.getCampaign(id).lockedRefunds, 40 * ONE, "the escrow keeps what it owes");
        _assertSolvent();

        // Retrying while blocked fails again, without side effects.
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.RefundFailed(tLiam, id);
        escrow.refundBatch(id, _ids(tLiam));
        assertEq(escrow.getCampaign(id).lockedRefunds, 40 * ONE);

        // The owed refund is not swept by release (YES keeps the escrow).
        escrow.release(id);
        assertEq(usdc.balanceOf(address(escrow)), 40 * ONE);

        // Once unblocked, the ticket is paid.
        usdc.setBlocked(liam, false);
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketRefunded(tLiam, id, liam, 40 * ONE);
        escrow.refundBatch(id, _ids(tLiam));
        assertEq(usdc.balanceOf(liam), 40 * ONE);
        assertTrue(escrow.getTicket(tLiam).paidOut);
        assertEq(escrow.getCampaign(id).lockedRefunds, 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertSolvent();
    }

    function test_refundBatch_revertsBeforeSettlement() public {
        _chargeAll();
        vm.warp(salesClose);
        vm.expectRevert(IWinzEscrow.NotSettled.selector);
        escrow.refundBatch(id, _ids(tMaya));

        vm.prank(relayer);
        uint64 paused = escrow.createCampaignFor(ana, _laterParams(), 0);
        vm.prank(relayer);
        escrow.setPaused(paused, true);
        vm.expectRevert(IWinzEscrow.NotSettled.selector);
        escrow.refundBatch(paused, _ids(tMaya));
        assertEq(usdc.balanceOf(maya), 0);
    }

    function test_refundBatch_revertsOnNoAndVoid() public {
        uint64 voided = _create(ana, 5 * ONE, 10_000, 0);
        uint256 voidTicket = _buyFor(voided, zoe, 1, 0);
        _settled(IWinzEscrow.Outcome.No);
        _settle(voided, IWinzEscrow.Outcome.Void);

        vm.expectRevert(IWinzEscrow.WrongOutcome.selector);
        escrow.refundBatch(id, _ids(tMaya));
        vm.expectRevert(IWinzEscrow.WrongOutcome.selector);
        escrow.refundBatch(voided, _ids(voidTicket));

        assertEq(usdc.balanceOf(maya), 0);
        assertEq(usdc.balanceOf(zoe), 0);
    }

    function test_refundBatch_revertsForUnknownCampaign() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        escrow.refundBatch(2, _ids(tMaya));
    }

    /// @dev Success criterion 6 runs batches of 50: one batch must fit well inside Arc's 30 M block.
    function test_refundBatch_fiftyTicketsFitInABlock() public {
        uint64 big = _create(ana, 20 * ONE, 10_000, 0);
        uint256[] memory ids = new uint256[](50);
        for (uint256 i; i < 50; ++i) {
            ids[i] = _buyFor(big, address(uint160(0xB0B0000 + i)), 1, 0);
        }
        _closeAndSettle(big, IWinzEscrow.Outcome.Yes);

        uint256 gasBefore = gasleft();
        escrow.refundBatch(big, ids);
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(gasUsed, 5_000_000, "a batch of 50 stays far below the 30 M block limit");
        assertEq(escrow.getCampaign(big).lockedRefunds, 0);
        for (uint256 i; i < 50; ++i) {
            assertEq(usdc.balanceOf(address(uint160(0xB0B0000 + i))), 20 * ONE);
        }
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // release
    // ----------------------------------------------------------------------------------------------

    function test_release_yes_sendsOnlyTheUnspentBudget() public {
        _settled(IWinzEscrow.Outcome.Yes);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignReleased(id, 990 * ONE);
        vm.prank(stranger);
        escrow.release(id);

        assertEq(usdc.balanceOf(joe), 990 * ONE, "hedgeBudget - hedgeSpent");
        assertEq(usdc.balanceOf(stranger), 0);
        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertTrue(c.released);
        assertEq(c.lockedRefunds, 80 * ONE, "YES: the escrow stays for the buyers");
        assertEq(usdc.balanceOf(address(escrow)), 80 * ONE);
        _assertSolvent();

        // Refunds still work after the release.
        escrow.refundBatch(id, _ids(tMaya, tLiam, tZoe));
        assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertSolvent();
    }

    function test_release_no_sendsBudgetAndEscrow() public {
        _settled(IWinzEscrow.Outcome.No);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignReleased(id, 1_070 * ONE);
        escrow.release(id);

        assertEq(usdc.balanceOf(joe), 1_070 * ONE, "990 unspent budget + 80 escrow");
        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertTrue(c.released);
        assertEq(c.lockedRefunds, 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertSolvent();
    }

    /// @dev ST-4: VOID is NO for the escrow, and the treasury gives the hedge cost back.
    function test_release_void_plusPayMerchant_makesTheMerchantWhole() public {
        _settled(IWinzEscrow.Outcome.Void);

        escrow.release(id);
        assertEq(usdc.balanceOf(joe), 1_070 * ONE);
        escrow.payMerchant(id);
        assertEq(usdc.balanceOf(joe), 1_080 * ONE, "full budget + full sales: the promo cost him nothing");
        assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertSolvent();
    }

    function test_release_yes_withBudgetFullySpent_emitsZeroAndCallsNoTransfer() public {
        uint64 tight = _create(ana, 20 * ONE, 10_000, 4 * ONE);
        uint256 ticketId = _buyFor(tight, maya, 1, 4 * ONE);
        _charge(ticketId, 4 * ONE);
        _closeAndSettle(tight, IWinzEscrow.Outcome.Yes);

        vm.expectCall(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector), 0);
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignReleased(tight, 0);
        escrow.release(tight);

        assertTrue(escrow.getCampaign(tight).released);
        assertEq(usdc.balanceOf(ana), 0);
        _assertSolvent();
    }

    function test_release_twiceReverts() public {
        _settled(IWinzEscrow.Outcome.No);
        escrow.release(id);

        vm.expectRevert(IWinzEscrow.AlreadyReleased.selector);
        escrow.release(id);
        assertEq(usdc.balanceOf(joe), 1_070 * ONE);
    }

    function test_release_revertsBeforeSettlement() public {
        _chargeAll();
        vm.warp(salesClose);
        vm.expectRevert(IWinzEscrow.NotSettled.selector);
        escrow.release(id);
        assertEq(usdc.balanceOf(joe), 0);
    }

    function test_release_revertsForUnknownCampaign() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        escrow.release(2);
    }

    /// @dev A NO release must not take the escrow of a neighbour campaign.
    function test_release_no_leavesOtherCampaignsUntouched() public {
        uint64 other = _create(ana, 10 * ONE, 10_000, 30 * ONE);
        _buyFor(other, zoe, 3, 0);
        _settled(IWinzEscrow.Outcome.No);

        escrow.release(id);
        assertEq(usdc.balanceOf(address(escrow)), 60 * ONE, "ana: 30 budget + 30 escrow");
        assertEq(escrow.getCampaign(other).lockedRefunds, 30 * ONE);
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------

    function _laterParams() private view returns (IWinzEscrow.CampaignParams memory p) {
        p = _params(ONE, 10_000);
        p.salesClose = uint64(block.timestamp) + 1 days;
    }
}
