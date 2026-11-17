// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";
import {TestUSDC} from "../src/mocks/TestUSDC.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @notice Emergency exits, seven days after salesClose without settlement (EC-4).
contract WinzEscrowEmergencyTest is EscrowFixture {
    uint64 internal id;
    uint256 internal tMaya;
    uint256 internal tLiam;

    /// @dev Joe at R = 50 %: 20 USDC a unit, 100 USDC budget. Maya buys 1 (refundable 10), Liam
    ///      buys 2 (refundable 20). Maya's ticket is charged 2 of its 3; Liam's 6 stay reserved.
    function setUp() public override {
        super.setUp();
        id = _create(joe, 20 * ONE, 5_000, 100 * ONE);
        tMaya = _buyFor(id, maya, 1, 3 * ONE);
        tLiam = _buyFor(id, liam, 2, 6 * ONE);
        _charge(tMaya, 2 * ONE);
    }

    // ----------------------------------------------------------------------------------------------
    // emergencyClaim
    // ----------------------------------------------------------------------------------------------

    function test_emergencyClaim_revertsBeforeTheDelay_passesAtTheDelay() public {
        vm.warp(salesClose + DELAY - 1);
        vm.expectRevert(IWinzEscrow.EmergencyNotActive.selector);
        escrow.emergencyClaim(tMaya);
        assertEq(usdc.balanceOf(maya), 0);

        vm.warp(salesClose + DELAY);
        escrow.emergencyClaim(tMaya);
        assertEq(usdc.balanceOf(maya), 10 * ONE);
    }

    /// @dev The v1.0 defect: paying `paid` with R < 100 % drained other campaigns. Only `refundable`
    ///      is in escrow, so only `refundable` is paid.
    function test_emergencyClaim_paysTheRefundableAmount_notThePricePaid() public {
        // A neighbour whose money must not move.
        uint64 other = _create(ana, 10 * ONE, 10_000, 50 * ONE);
        _buyFor(other, zoe, 4, 0);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        vm.warp(salesClose + DELAY);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketRefunded(tLiam, id, liam, 20 * ONE);
        vm.prank(stranger);
        escrow.emergencyClaim(tLiam);

        assertEq(escrow.getTicket(tLiam).paid, 40 * ONE);
        assertEq(usdc.balanceOf(liam), 20 * ONE, "refundable, not the 40 paid");
        assertEq(usdc.balanceOf(stranger), 0, "the caller is not the beneficiary");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore - 20 * ONE);
        assertTrue(escrow.getTicket(tLiam).paidOut);
        assertEq(escrow.getCampaign(id).lockedRefunds, 10 * ONE);

        IWinzEscrow.Campaign memory neighbour = escrow.getCampaign(other);
        assertEq(neighbour.lockedRefunds, 40 * ONE);
        assertEq(neighbour.hedgeBudget, 50 * ONE);
        _assertSolvent();
    }

    function test_emergencyClaim_twiceReverts() public {
        vm.warp(salesClose + DELAY);
        escrow.emergencyClaim(tMaya);

        vm.expectRevert(IWinzEscrow.AlreadyPaidOut.selector);
        escrow.emergencyClaim(tMaya);
        assertEq(usdc.balanceOf(maya), 10 * ONE);
        _assertSolvent();
    }

    function test_emergencyClaim_revertsForUnknownTicket() public {
        vm.warp(salesClose + DELAY);
        vm.expectRevert(IWinzEscrow.TicketNotFound.selector);
        escrow.emergencyClaim(0);
        vm.expectRevert(IWinzEscrow.TicketNotFound.selector);
        escrow.emergencyClaim(3);
    }

    function test_emergencyClaim_revertsOnASettledCampaign_evenLongAfter() public {
        _charge(tLiam, 0);
        _closeAndSettle(id, IWinzEscrow.Outcome.No);
        vm.warp(salesClose + DELAY + 30 days);

        vm.expectRevert(IWinzEscrow.EmergencyNotActive.selector);
        escrow.emergencyClaim(tMaya);
        assertEq(usdc.balanceOf(maya), 0, "a NO stays a NO");
    }

    function test_emergencyClaim_blockedBuyer_staysOwedUntilUnblocked() public {
        vm.warp(salesClose + DELAY);
        usdc.setBlocked(maya, true);

        vm.expectRevert(abi.encodeWithSelector(TestUSDC.AccountBlocked.selector, maya));
        escrow.emergencyClaim(tMaya);
        assertFalse(escrow.getTicket(tMaya).paidOut);
        assertEq(escrow.getCampaign(id).lockedRefunds, 30 * ONE);

        // Another buyer is not affected.
        escrow.emergencyClaim(tLiam);
        assertEq(usdc.balanceOf(liam), 20 * ONE);

        usdc.setBlocked(maya, false);
        escrow.emergencyClaim(tMaya);
        assertEq(usdc.balanceOf(maya), 10 * ONE);
        assertEq(escrow.getCampaign(id).lockedRefunds, 0);
        _assertSolvent();
    }

    function test_emergencyClaim_worksOnAPausedCampaign() public {
        vm.prank(relayer);
        escrow.setPaused(id, true);
        vm.warp(salesClose + DELAY);
        escrow.emergencyClaim(tMaya);
        assertEq(usdc.balanceOf(maya), 10 * ONE);
    }

    // ----------------------------------------------------------------------------------------------
    // emergencyReleaseBudget
    // ----------------------------------------------------------------------------------------------

    function test_emergencyReleaseBudget_revertsBeforeTheDelay_passesAtTheDelay() public {
        vm.warp(salesClose + DELAY - 1);
        vm.expectRevert(IWinzEscrow.EmergencyNotActive.selector);
        escrow.emergencyReleaseBudget(id);
        assertFalse(escrow.getCampaign(id).released);

        vm.warp(salesClose + DELAY);
        escrow.emergencyReleaseBudget(id);
        assertTrue(escrow.getCampaign(id).released);
    }

    function test_emergencyReleaseBudget_returnsUnspentBudget_reservationsIncluded() public {
        uint256 joeBefore = usdc.balanceOf(joe); // 30: his (1 - R) share of the three units sold
        vm.warp(salesClose + DELAY);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignReleased(id, 98 * ONE);
        vm.prank(stranger);
        escrow.emergencyReleaseBudget(id);

        assertEq(usdc.balanceOf(joe), joeBefore + 98 * ONE, "100 budget - 2 spent, the 6 reserved included");
        assertEq(usdc.balanceOf(stranger), 0);
        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertTrue(c.released);
        assertEq(c.hedgeReserved, 0, "reservations are dropped");
        assertEq(c.hedgeSpent, 2 * ONE);
        assertEq(c.lockedRefunds, 30 * ONE, "the buyers' money stays");
        assertEq(uint8(c.status), uint8(IWinzEscrow.Status.Live), "never settled");
        assertEq(usdc.balanceOf(address(escrow)), 30 * ONE);
        _assertSolvent();
    }

    function test_emergencyReleaseBudget_twiceReverts() public {
        vm.warp(salesClose + DELAY);
        escrow.emergencyReleaseBudget(id);
        uint256 joeAfter = usdc.balanceOf(joe);

        vm.expectRevert(IWinzEscrow.AlreadyReleased.selector);
        escrow.emergencyReleaseBudget(id);
        assertEq(usdc.balanceOf(joe), joeAfter);
    }

    function test_emergencyReleaseBudget_revertsForUnknownCampaign() public {
        vm.warp(salesClose + DELAY);
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        escrow.emergencyReleaseBudget(2);
    }

    function test_emergencyReleaseBudget_revertsOnASettledCampaign() public {
        _charge(tLiam, 0);
        _closeAndSettle(id, IWinzEscrow.Outcome.Yes);
        vm.warp(salesClose + DELAY + 1);

        vm.expectRevert(IWinzEscrow.EmergencyNotActive.selector);
        escrow.emergencyReleaseBudget(id);

        // Positive control: the regular release is the way out of a settled campaign.
        escrow.release(id);
        assertTrue(escrow.getCampaign(id).released);
    }

    function test_afterEmergencyRelease_chargeSettleAndTopUpRevert() public {
        vm.warp(salesClose + DELAY);
        escrow.emergencyReleaseBudget(id);

        vm.expectRevert(IWinzEscrow.AlreadyReleased.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(tLiam), _amounts(ONE));

        vm.expectRevert(IWinzEscrow.EmergencyActive.selector);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.Yes);

        vm.expectRevert(IWinzEscrow.AlreadyReleased.selector);
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, ONE);

        vm.expectRevert(IWinzEscrow.NotSettled.selector);
        escrow.release(id);

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.hedgeSpent, 2 * ONE);
        assertEq(uint8(c.status), uint8(IWinzEscrow.Status.Live));
        _assertSolvent();
    }

    function test_emergencyExits_workInEitherOrder_andEmptyTheCampaign() public {
        uint256 joeBefore = usdc.balanceOf(joe);
        vm.warp(salesClose + DELAY);

        escrow.emergencyClaim(tMaya);
        escrow.emergencyReleaseBudget(id);
        escrow.emergencyClaim(tLiam);

        assertEq(usdc.balanceOf(maya), 10 * ONE);
        assertEq(usdc.balanceOf(liam), 20 * ONE);
        assertEq(usdc.balanceOf(joe), joeBefore + 98 * ONE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertSolvent();
    }

    /// @dev closeSales moves salesClose earlier, so the emergency clock starts earlier too.
    function test_emergencyDelay_countsFromTheEarlyClose() public {
        uint64 early = _create(ana, 20 * ONE, 10_000, 0);
        uint256 ticketId = _buyFor(early, zoe, 1, 0);
        vm.warp(START + 1 hours);
        vm.prank(relayer);
        escrow.closeSales(early);

        vm.warp(START + 1 hours + DELAY - 1);
        vm.expectRevert(IWinzEscrow.EmergencyNotActive.selector);
        escrow.emergencyClaim(ticketId);

        vm.warp(START + 1 hours + DELAY);
        escrow.emergencyClaim(ticketId);
        assertEq(usdc.balanceOf(zoe), 20 * ONE);

        // The campaign created with the original salesClose is still outside its own window.
        vm.expectRevert(IWinzEscrow.EmergencyNotActive.selector);
        escrow.emergencyClaim(tMaya);
    }
}
