// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @notice chargeHedge: once per ticket, never above the signed guarantee (EC-5).
contract WinzEscrowHedgeTest is EscrowFixture {
    uint64 internal id;

    function setUp() public override {
        super.setUp();
        id = _createJoe();
    }

    function test_charge_belowGuarantee_releasesTheWholeReservation() public {
        uint256 ticketId = _buyFor(id, maya, 1, 5 * ONE);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.HedgeCharged(ticketId, id, 3 * ONE);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(ticketId), _amounts(3 * ONE));

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.hedgeReserved, 0, "the whole reservation is released");
        assertEq(c.hedgeSpent, 3 * ONE);
        assertEq(c.hedgeBudget, 1_000 * ONE, "the deposited total does not move");
        assertEq(escrow.availableBudget(id), 997 * ONE, "the saving stays with the merchant");
        assertTrue(escrow.getTicket(ticketId).hedgeCharged);
        assertEq(escrow.getTicket(ticketId).maxHedgeCost, 5 * ONE, "the guarantee is kept on the ticket");

        assertEq(usdc.balanceOf(treasury), treasuryBefore + 3 * ONE, "the cost goes to the treasury");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore - 3 * ONE);
        assertEq(usdc.balanceOf(oracle), 0, "the oracle never holds funds");
        _assertSolvent();
    }

    function test_charge_exactlyTheGuarantee() public {
        uint256 ticketId = _buyFor(id, maya, 1, 5 * ONE);
        _charge(ticketId, 5 * ONE);
        assertEq(escrow.getCampaign(id).hedgeSpent, 5 * ONE);
        assertEq(escrow.getCampaign(id).hedgeReserved, 0);
        _assertSolvent();
    }

    function test_charge_aboveGuarantee_reverts() public {
        uint256 ticketId = _buyFor(id, maya, 1, 5 * ONE);

        vm.expectRevert(IWinzEscrow.HedgeAboveGuarantee.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(ticketId), _amounts(5 * ONE + 1));

        assertFalse(escrow.getTicket(ticketId).hedgeCharged);
        assertEq(escrow.getCampaign(id).hedgeSpent, 0);
        assertEq(escrow.getCampaign(id).hedgeReserved, 5 * ONE);
    }

    function testFuzz_charge_neverAboveGuarantee(uint128 guarantee, uint128 amount) public {
        guarantee = uint128(bound(guarantee, 0, 1_000 * ONE));
        amount = uint128(bound(amount, 0, 2_000 * ONE));
        uint256 ticketId = _buyFor(id, maya, 1, guarantee);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(oracle);
        if (amount > guarantee) {
            vm.expectRevert(IWinzEscrow.HedgeAboveGuarantee.selector);
            escrow.chargeHedge(_ids(ticketId), _amounts(amount));
            assertEq(usdc.balanceOf(treasury), treasuryBefore);
            assertEq(escrow.getCampaign(id).hedgeSpent, 0);
        } else {
            escrow.chargeHedge(_ids(ticketId), _amounts(amount));
            assertEq(usdc.balanceOf(treasury), treasuryBefore + amount);
            assertEq(escrow.getCampaign(id).hedgeSpent, amount);
            assertEq(escrow.getCampaign(id).hedgeReserved, 0);
        }
        _assertSolvent();
    }

    function test_charge_zeroAmount_onlyReleasesTheReservation() public {
        uint256 ticketId = _buyFor(id, maya, 1, 5 * ONE);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        // No token transfer at all for a zero total.
        vm.expectCall(address(usdc), abi.encodeWithSelector(IERC20.transfer.selector), 0);
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.HedgeCharged(ticketId, id, 0);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(ticketId), _amounts(0));

        assertTrue(escrow.getTicket(ticketId).hedgeCharged);
        assertEq(escrow.getCampaign(id).hedgeReserved, 0);
        assertEq(escrow.getCampaign(id).hedgeSpent, 0);
        assertEq(escrow.availableBudget(id), 1_000 * ONE);
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
        _assertSolvent();
    }

    function test_charge_batchAcrossCampaigns_oneTransferOfTheTotal() public {
        uint64 other = _create(ana, 10 * ONE, 5_000, 50 * ONE);
        uint256 t1 = _buyFor(id, maya, 1, 5 * ONE);
        uint256 t2 = _buyFor(other, liam, 2, 4 * ONE);
        uint256 t3 = _buyFor(id, zoe, 1, 6 * ONE);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.expectCall(address(usdc), abi.encodeCall(IERC20.transfer, (treasury, 9 * ONE)), 1);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(t1, t2, t3), _amounts(2 * ONE, 4 * ONE, 3 * ONE));

        assertEq(usdc.balanceOf(treasury), treasuryBefore + 9 * ONE);
        assertEq(escrow.getCampaign(id).hedgeSpent, 5 * ONE, "joe: tickets 1 and 3");
        assertEq(escrow.getCampaign(other).hedgeSpent, 4 * ONE, "ana: ticket 2");
        assertEq(escrow.getCampaign(id).hedgeReserved, 0);
        assertEq(escrow.getCampaign(other).hedgeReserved, 0);
        _assertSolvent();
    }

    function test_charge_emptyBatchIsANoOp() public {
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        vm.prank(oracle);
        escrow.chargeHedge(new uint256[](0), new uint128[](0));
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
    }

    function test_charge_worksWhilePausedAndAfterSalesClose() public {
        uint256 t1 = _buyFor(id, maya, 1, 5 * ONE);
        uint256 t2 = _buyFor(id, liam, 1, 5 * ONE);

        vm.prank(relayer);
        escrow.setPaused(id, true);
        _charge(t1, ONE);

        vm.warp(salesClose + 1 hours);
        _charge(t2, ONE);
        assertEq(escrow.getCampaign(id).hedgeSpent, 2 * ONE);
        _assertSolvent();
    }

    function test_charge_revertsForNonOracle() public {
        uint256 ticketId = _buyFor(id, maya, 1, 5 * ONE);
        address[5] memory callers = [owner, relayer, treasury, joe, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IWinzEscrow.Unauthorized.selector);
            vm.prank(callers[i]);
            escrow.chargeHedge(_ids(ticketId), _amounts(ONE));
        }
        assertFalse(escrow.getTicket(ticketId).hedgeCharged);
    }

    function test_charge_revertsOnLengthMismatch() public {
        uint256 ticketId = _buyFor(id, maya, 1, 5 * ONE);

        vm.expectRevert(IWinzEscrow.LengthMismatch.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(ticketId), _amounts(ONE, ONE));

        vm.expectRevert(IWinzEscrow.LengthMismatch.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(ticketId, ticketId), _amounts(ONE));
    }

    function test_charge_revertsForUnknownTicket() public {
        _buyFor(id, maya, 1, 5 * ONE);

        vm.expectRevert(IWinzEscrow.TicketNotFound.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(0), _amounts(0));

        vm.expectRevert(IWinzEscrow.TicketNotFound.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(2), _amounts(0));
    }

    function test_charge_secondChargeOfATicketReverts() public {
        uint256 ticketId = _buyFor(id, maya, 1, 5 * ONE);
        _charge(ticketId, ONE);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.expectRevert(IWinzEscrow.HedgeAlreadyCharged.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(ticketId), _amounts(ONE));

        // Not even a zero charge.
        vm.expectRevert(IWinzEscrow.HedgeAlreadyCharged.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(ticketId), _amounts(0));

        assertEq(escrow.getCampaign(id).hedgeSpent, ONE);
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
        _assertSolvent();
    }

    function test_charge_duplicateTicketInOneBatchReverts() public {
        uint256 ticketId = _buyFor(id, maya, 1, 5 * ONE);

        vm.expectRevert(IWinzEscrow.HedgeAlreadyCharged.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(ticketId, ticketId), _amounts(ONE, ONE));

        assertFalse(escrow.getTicket(ticketId).hedgeCharged, "the batch is atomic");
        assertEq(escrow.getCampaign(id).hedgeSpent, 0);
    }

    function test_charge_batchIsAtomic() public {
        uint256 t1 = _buyFor(id, maya, 1, 5 * ONE);
        uint256 t2 = _buyFor(id, liam, 1, 5 * ONE);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.expectRevert(IWinzEscrow.HedgeAboveGuarantee.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(t1, t2), _amounts(ONE, 6 * ONE));

        assertFalse(escrow.getTicket(t1).hedgeCharged, "the valid first item was rolled back");
        assertEq(escrow.getCampaign(id).hedgeReserved, 10 * ONE);
        assertEq(usdc.balanceOf(treasury), treasuryBefore);

        // Positive control: the same batch within the guarantees passes.
        vm.prank(oracle);
        escrow.chargeHedge(_ids(t1, t2), _amounts(ONE, 5 * ONE));
        assertEq(usdc.balanceOf(treasury), treasuryBefore + 6 * ONE);
    }

    function test_charge_revertsOnceSettled() public {
        uint256 t1 = _buyFor(id, maya, 1, 5 * ONE);
        _charge(t1, ONE);
        _closeAndSettle(id, IWinzEscrow.Outcome.Yes);

        vm.expectRevert(IWinzEscrow.AlreadySettled.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(t1), _amounts(0));
        assertEq(escrow.getCampaign(id).hedgeSpent, ONE);
    }

    function test_charge_revertsOnceBudgetEmergencyReleased() public {
        uint256 t1 = _buyFor(id, maya, 1, 5 * ONE);
        uint256 t2 = _buyFor(id, liam, 1, 5 * ONE);
        vm.warp(salesClose + DELAY);

        // Positive control: inside the emergency window, before the release, a charge still passes.
        _charge(t1, ONE);

        escrow.emergencyReleaseBudget(id);

        vm.expectRevert(IWinzEscrow.AlreadyReleased.selector);
        vm.prank(oracle);
        escrow.chargeHedge(_ids(t2), _amounts(0));
        assertEq(escrow.getCampaign(id).hedgeSpent, ONE);
        _assertSolvent();
    }
}
