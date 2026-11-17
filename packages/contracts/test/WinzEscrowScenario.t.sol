// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @notice Two merchants on the same Gemini instrument (HE-3, HE-4, section 9.5): the engine holds
///         one shared position, but each merchant is charged for its own tickets only and never
///         above its own quotes.
contract WinzEscrowScenarioTest is EscrowFixture {
    uint128 internal constant CENT = 10_000; // 0.01 USDC

    uint64 internal joeId;
    uint64 internal anaId;

    function setUp() public override {
        super.setUp();
        // Joe: pizza at 20 USDC, 100 % back, 100 USDC budget. Ana: burger at 12 USDC, 50 % back, 50 USDC.
        joeId = _create(joe, 20 * ONE, 10_000, 100 * ONE);
        anaId = _create(ana, 12 * ONE, 5_000, 50 * ONE);
        assertEq(
            escrow.getCampaign(joeId).instrument, escrow.getCampaign(anaId).instrument, "same instrument"
        );
    }

    function test_twoMerchants_sameInstrument_fullYesCycle() public {
        uint256 treasuryStart = usdc.balanceOf(treasury);

        // Interleaved sales, each with its own guaranteed hedge cost.
        uint256 j1 = _buyFor(joeId, maya, 1, 300 * CENT); // exposure 20
        uint256 a1 = _buyFor(anaId, liam, 2, 180 * CENT); // exposure 12
        uint256 j2 = _buyFor(joeId, zoe, 1, 320 * CENT); // exposure 20
        uint256 a2 = _buyFor(anaId, maya, 1, 100 * CENT); // exposure 6

        assertEq(usdc.balanceOf(joe), 0, "R = 100 %: nothing before the game");
        assertEq(usdc.balanceOf(ana), 18 * ONE, "R = 50 %: half of 36 at once");
        assertEq(escrow.getCampaign(joeId).hedgeReserved, 620 * CENT);
        assertEq(escrow.getCampaign(anaId).hedgeReserved, 280 * CENT);
        _assertSolvent();

        // The engine filled the shared position FIFO. Real cost per lot: 2.40, 1.50, 3.50, 0.90.
        // Lot j2 cost 3.50 against a 3.20 guarantee: charging the real cost is refused...
        vm.expectRevert(IWinzEscrow.HedgeAboveGuarantee.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(j1, a1, j2), _amounts(240 * CENT, 150 * CENT, 350 * CENT));

        // ...so it is charged min(real cost, guarantee) and Winz absorbs the 0.30.
        vm.prank(oracle);
        escrow.chargeHedge(_ids(j1, a1, j2), _amounts(240 * CENT, 150 * CENT, 320 * CENT));
        _charge(a2, 90 * CENT);

        IWinzEscrow.Campaign memory cj = escrow.getCampaign(joeId);
        IWinzEscrow.Campaign memory ca = escrow.getCampaign(anaId);
        assertEq(cj.hedgeSpent, 560 * CENT, "joe pays for j1 and j2 only");
        assertEq(ca.hedgeSpent, 240 * CENT, "ana pays for a1 and a2 only");
        assertLe(cj.hedgeSpent, 620 * CENT, "never above joe's quotes");
        assertLe(ca.hedgeSpent, 280 * CENT, "never above ana's quotes");
        assertEq(cj.hedgeReserved, 0);
        assertEq(ca.hedgeReserved, 0);
        assertEq(escrow.availableBudget(joeId), 100 * ONE - 560 * CENT);
        assertEq(escrow.availableBudget(anaId), 50 * ONE - 240 * CENT);
        assertEq(
            usdc.balanceOf(treasury), treasuryStart - 76 * ONE + 800 * CENT, "purchases out, hedge cost in"
        );
        _assertSolvent();

        // The condition is YES for both campaigns.
        vm.warp(salesClose);
        _settle(joeId, IWinzEscrow.Outcome.Yes);
        _settle(anaId, IWinzEscrow.Outcome.Yes);
        assertEq(escrow.getCampaign(joeId).merchantDue, 40 * ONE);
        assertEq(escrow.getCampaign(anaId).merchantDue, 18 * ONE);

        escrow.refundBatch(joeId, _ids(j1, j2));
        escrow.refundBatch(anaId, _ids(a1, a2));
        escrow.payMerchant(joeId);
        escrow.payMerchant(anaId);
        escrow.release(joeId);
        escrow.release(anaId);

        // Customers: maya bought from both.
        assertEq(usdc.balanceOf(maya), 26 * ONE, "20 from joe + 6 from ana");
        assertEq(usdc.balanceOf(liam), 12 * ONE);
        assertEq(usdc.balanceOf(zoe), 20 * ONE);

        // Merchants: full sales + budget back, minus their own hedge cost.
        assertEq(usdc.balanceOf(joe), 40 * ONE + 100 * ONE - 560 * CENT);
        assertEq(usdc.balanceOf(ana), 36 * ONE + 50 * ONE - 240 * CENT);

        assertEq(usdc.balanceOf(address(escrow)), 0, "nothing is left behind");
        _assertSolvent();
    }

    function test_twoMerchants_oneRunsOutOfBudget_theOtherKeepsSelling() public {
        // Joe's budget is fully reserved by one large guarantee.
        _buyFor(joeId, maya, 1, 100 * ONE);

        IWinzEscrow.Quote memory q = _quote(joeId, liam, 1, 1);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.BudgetExceeded.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);

        // Ana's budget is hers alone.
        uint256 a1 = _buyFor(anaId, liam, 1, 50 * ONE);
        assertEq(escrow.availableBudget(anaId), 0);
        assertEq(escrow.getTicket(a1).campaignId, anaId);
        _assertSolvent();
    }

    function test_twoMerchants_oppositeOutcomesOfTheSameBatch() public {
        // Same instrument, but the oracle settles campaigns one by one: a VOID on ana does not
        // touch joe's YES.
        uint256 j1 = _buyFor(joeId, maya, 1, 3 * ONE);
        uint256 a1 = _buyFor(anaId, liam, 1, 2 * ONE);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(j1, a1), _amounts(2 * ONE, ONE));

        vm.warp(salesClose);
        _settle(joeId, IWinzEscrow.Outcome.Yes);
        _settle(anaId, IWinzEscrow.Outcome.Void);

        // A refund batch on ana's VOID campaign is refused; joe's goes through.
        vm.expectRevert(IWinzEscrow.WrongOutcome.selector);
        escrow.refundBatch(anaId, _ids(a1));
        escrow.refundBatch(joeId, _ids(j1, a1));
        assertEq(usdc.balanceOf(maya), 20 * ONE);
        assertEq(usdc.balanceOf(liam), 0, "ana's ticket is not refunded through joe's campaign");

        escrow.release(joeId);
        escrow.release(anaId);
        escrow.payMerchant(joeId);
        escrow.payMerchant(anaId);
        assertEq(usdc.balanceOf(joe), 20 * ONE + 98 * ONE, "exposure + unspent budget");
        assertEq(
            usdc.balanceOf(ana), 12 * ONE + 50 * ONE, "full sale + full budget: the hedge cost came back"
        );
        assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertSolvent();
    }

    /// @dev Whatever the guarantees and the charges, a campaign's hedgeSpent is the sum of the charges
    ///      of its own tickets, and at most the sum of its own guarantees.
    function testFuzz_twoMerchants_chargedOnlyForOwnTickets(
        uint128[6] memory guarantees,
        uint128[6] memory charges
    ) public {
        uint256[] memory ticketIds = new uint256[](6);
        uint128[] memory amounts = new uint128[](6);
        uint256[2] memory ownGuarantees;
        uint256[2] memory ownCharges;

        for (uint256 i; i < 6; ++i) {
            uint256 who = i % 2; // 0: joe, 1: ana
            uint128 guarantee = uint128(bound(guarantees[i], 0, 8 * ONE));
            amounts[i] = uint128(bound(charges[i], 0, guarantee));
            ticketIds[i] = _buyFor(who == 0 ? joeId : anaId, maya, 1, guarantee);
            ownGuarantees[who] += guarantee;
            ownCharges[who] += amounts[i];
        }

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(oracle);
        escrow.chargeHedge(ticketIds, amounts);

        assertEq(escrow.getCampaign(joeId).hedgeSpent, ownCharges[0]);
        assertEq(escrow.getCampaign(anaId).hedgeSpent, ownCharges[1]);
        assertLe(escrow.getCampaign(joeId).hedgeSpent, ownGuarantees[0]);
        assertLe(escrow.getCampaign(anaId).hedgeSpent, ownGuarantees[1]);
        assertEq(usdc.balanceOf(treasury), treasuryBefore + ownCharges[0] + ownCharges[1]);
        _assertSolvent();
    }
}
