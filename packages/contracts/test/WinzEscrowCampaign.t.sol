// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @notice createCampaignFor, topUpBudgetFor, setPaused and closeSales.
contract WinzEscrowCampaignTest is EscrowFixture {
    // ----------------------------------------------------------------------------------------------
    // createCampaignFor
    // ----------------------------------------------------------------------------------------------

    function test_create_storesCampaignAndPullsBudget() public {
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        IWinzEscrow.CampaignParams memory params = _params(20 * ONE, 10_000);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignCreated(1, joe, INSTRUMENT, 10_000, salesClose, 20 * ONE, 1_000 * ONE);
        vm.prank(relayer);
        uint64 id = escrow.createCampaignFor(joe, params, 1_000 * ONE);

        assertEq(id, 1, "ids start at 1");
        assertEq(escrow.campaignCount(), 1);

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.merchant, joe);
        assertEq(c.instrument, INSTRUMENT);
        assertEq(c.salesClose, salesClose);
        assertEq(c.unitPrice, 20 * ONE);
        assertEq(c.refundBps, 10_000);
        assertEq(c.hedgeBudget, 1_000 * ONE);
        assertEq(c.hedgeReserved, 0);
        assertEq(c.hedgeSpent, 0);
        assertEq(c.lockedRefunds, 0);
        assertEq(c.merchantDue, 0);
        assertEq(uint8(c.status), uint8(IWinzEscrow.Status.Live));
        assertFalse(c.released);

        assertEq(usdc.balanceOf(treasury), treasuryBefore - 1_000 * ONE, "budget pulled from the treasury");
        assertEq(usdc.balanceOf(address(escrow)), 1_000 * ONE);
        assertEq(usdc.balanceOf(relayer), 0, "the relayer never holds funds");
        _assertSolvent();
    }

    function test_create_idsIncrement() public {
        assertEq(_create(joe, 20 * ONE, 10_000, 10 * ONE), 1);
        assertEq(_create(ana, 5 * ONE, 5_000, 20 * ONE), 2);
        assertEq(_create(joe, 7 * ONE, 2_500, 0), 3);
        assertEq(escrow.campaignCount(), 3);
        assertEq(escrow.getCampaign(2).merchant, ana);
        _assertSolvent();
    }

    function test_create_acceptsZeroBudget_withoutCallingTheToken() public {
        IWinzEscrow.CampaignParams memory params = _params(20 * ONE, 10_000);
        // No allowance at all: a zero budget must not reach the token.
        vm.prank(treasury);
        usdc.approve(address(escrow), 0);

        vm.prank(relayer);
        uint64 id = escrow.createCampaignFor(joe, params, 0);
        assertEq(escrow.getCampaign(id).hedgeBudget, 0);
        _assertSolvent();
    }

    function test_create_revertsForNonRelayer() public {
        IWinzEscrow.CampaignParams memory params = _params(20 * ONE, 10_000);
        address[5] memory callers = [owner, oracle, treasury, joe, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IWinzEscrow.Unauthorized.selector);
            vm.prank(callers[i]);
            escrow.createCampaignFor(joe, params, ONE);
        }
        assertEq(escrow.campaignCount(), 0);
    }

    function test_create_revertsOnZeroMerchant() public {
        IWinzEscrow.CampaignParams memory params = _params(20 * ONE, 10_000);
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.createCampaignFor(address(0), params, ONE);
    }

    function test_create_revertsOnZeroUnitPrice() public {
        IWinzEscrow.CampaignParams memory params = _params(0, 10_000);
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.createCampaignFor(joe, params, ONE);
    }

    function test_create_refundBpsBounds() public {
        IWinzEscrow.CampaignParams memory params = _params(20 * ONE, 0);
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.createCampaignFor(joe, params, ONE);

        params.refundBps = 10_001;
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.createCampaignFor(joe, params, ONE);

        // Positive controls: both ends of the valid range.
        params.refundBps = 1;
        vm.prank(relayer);
        assertEq(escrow.createCampaignFor(joe, params, ONE), 1);
        params.refundBps = 10_000;
        vm.prank(relayer);
        assertEq(escrow.createCampaignFor(joe, params, ONE), 2);
    }

    function test_create_salesCloseMustBeInTheFuture() public {
        IWinzEscrow.CampaignParams memory params = _params(20 * ONE, 10_000);

        params.salesClose = uint64(block.timestamp) - 1;
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.createCampaignFor(joe, params, ONE);

        params.salesClose = uint64(block.timestamp);
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.createCampaignFor(joe, params, ONE);

        // Positive control: one second ahead is enough.
        params.salesClose = uint64(block.timestamp) + 1;
        vm.prank(relayer);
        assertEq(escrow.createCampaignFor(joe, params, ONE), 1);
    }

    function test_create_revertsWhenTreasuryCannotPay() public {
        IWinzEscrow.CampaignParams memory params = _params(20 * ONE, 10_000);
        uint256 balance = usdc.balanceOf(treasury);

        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, treasury, balance, balance + 1
            )
        );
        vm.prank(relayer);
        escrow.createCampaignFor(joe, params, uint128(balance + 1));

        assertEq(escrow.campaignCount(), 0, "nothing was created");

        // Positive control: the whole balance is fine.
        vm.prank(relayer);
        assertEq(escrow.createCampaignFor(joe, params, uint128(balance)), 1);
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // topUpBudgetFor
    // ----------------------------------------------------------------------------------------------

    function test_topUp_addsBudgetFromTreasury() public {
        uint64 id = _createJoe();
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.BudgetToppedUp(id, 250 * ONE);
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, 250 * ONE);

        assertEq(escrow.getCampaign(id).hedgeBudget, 1_250 * ONE);
        assertEq(escrow.availableBudget(id), 1_250 * ONE);
        assertEq(usdc.balanceOf(treasury), treasuryBefore - 250 * ONE);
        _assertSolvent();
    }

    function test_topUp_worksWhilePausedAndAfterSalesClose() public {
        uint64 id = _createJoe();
        vm.prank(relayer);
        escrow.setPaused(id, true);
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, ONE);

        vm.warp(salesClose + 1);
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, ONE);
        assertEq(escrow.getCampaign(id).hedgeBudget, 1_002 * ONE);
        _assertSolvent();
    }

    function test_topUp_revertsForNonRelayer() public {
        uint64 id = _createJoe();
        address[5] memory callers = [owner, oracle, treasury, joe, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IWinzEscrow.Unauthorized.selector);
            vm.prank(callers[i]);
            escrow.topUpBudgetFor(id, ONE);
        }
    }

    function test_topUp_revertsForUnknownCampaign() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        vm.prank(relayer);
        escrow.topUpBudgetFor(1, ONE);
    }

    function test_topUp_revertsOnZeroAmount() public {
        uint64 id = _createJoe();
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, 0);
    }

    function test_topUp_revertsOnceSettled() public {
        uint64 id = _createJoe();
        _closeAndSettle(id, IWinzEscrow.Outcome.No);

        vm.expectRevert(IWinzEscrow.AlreadySettled.selector);
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, ONE);
    }

    function test_topUp_revertsOnceEmergencyReleased() public {
        uint64 id = _createJoe();
        vm.warp(salesClose + DELAY);

        // Positive control: the emergency window alone does not close top-ups.
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, ONE);

        escrow.emergencyReleaseBudget(id);

        vm.expectRevert(IWinzEscrow.AlreadyReleased.selector);
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, ONE);
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // setPaused
    // ----------------------------------------------------------------------------------------------

    function test_setPaused_pausesAndResumes() public {
        uint64 id = _createJoe();

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignPaused(id, true);
        vm.prank(relayer);
        escrow.setPaused(id, true);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.Paused));

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.CampaignPaused(id, false);
        vm.prank(relayer);
        escrow.setPaused(id, false);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.Live));
    }

    function test_setPaused_revertsForNonRelayer() public {
        uint64 id = _createJoe();
        address[5] memory callers = [owner, oracle, treasury, joe, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IWinzEscrow.Unauthorized.selector);
            vm.prank(callers[i]);
            escrow.setPaused(id, true);
        }
    }

    function test_setPaused_revertsForUnknownCampaign() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        vm.prank(relayer);
        escrow.setPaused(1, true);
    }

    function test_setPaused_revertsWhenNothingChanges() public {
        uint64 id = _createJoe();

        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.setPaused(id, false);

        vm.prank(relayer);
        escrow.setPaused(id, true);

        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.setPaused(id, true);
    }

    function test_setPaused_refusedFromSalesCloseOn() public {
        uint64 id = _createJoe();

        // Positive control: the last second before salesClose still works.
        vm.warp(salesClose - 1);
        vm.prank(relayer);
        escrow.setPaused(id, true);

        vm.warp(salesClose);
        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(relayer);
        escrow.setPaused(id, false);

        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.Paused));
    }

    function test_setPaused_refusedAfterSettlement() public {
        uint64 id = _createJoe();
        _closeAndSettle(id, IWinzEscrow.Outcome.Yes);

        vm.expectRevert(IWinzEscrow.AlreadySettled.selector);
        vm.prank(relayer);
        escrow.setPaused(id, true);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.SettledYes));
    }

    // ----------------------------------------------------------------------------------------------
    // closeSales
    // ----------------------------------------------------------------------------------------------

    function test_closeSales_movesSalesCloseToNow() public {
        uint64 id = _createJoe();
        vm.warp(START + 1 hours);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.SalesClosedEarly(id, START + 1 hours);
        vm.prank(relayer);
        escrow.closeSales(id);

        assertEq(escrow.getCampaign(id).salesClose, START + 1 hours);
        assertEq(
            uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.Live), "status is not touched"
        );
    }

    function test_closeSales_stopsSalesInTheSameBlock_andAllowsSettlement() public {
        uint64 id = _createJoe();
        // Positive control: a sale goes through just before the close.
        _buyFor(id, maya, 1, 0);

        vm.prank(relayer);
        escrow.closeSales(id);

        IWinzEscrow.Quote memory q = _quote(id, liam, 1, 0);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);

        _settle(id, IWinzEscrow.Outcome.No);
        assertEq(uint8(escrow.getCampaign(id).status), uint8(IWinzEscrow.Status.SettledNo));
    }

    function test_closeSales_worksWhilePaused() public {
        uint64 id = _createJoe();
        vm.prank(relayer);
        escrow.setPaused(id, true);
        vm.prank(relayer);
        escrow.closeSales(id);
        assertEq(escrow.getCampaign(id).salesClose, START);
    }

    function test_closeSales_revertsForNonRelayer() public {
        uint64 id = _createJoe();
        address[5] memory callers = [owner, oracle, treasury, joe, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IWinzEscrow.Unauthorized.selector);
            vm.prank(callers[i]);
            escrow.closeSales(id);
        }
        assertEq(escrow.getCampaign(id).salesClose, salesClose);
    }

    function test_closeSales_revertsForUnknownCampaign() public {
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        vm.prank(relayer);
        escrow.closeSales(1);
    }

    function test_closeSales_cannotBeCalledTwice() public {
        uint64 id = _createJoe();
        vm.prank(relayer);
        escrow.closeSales(id);

        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(relayer);
        escrow.closeSales(id);

        vm.warp(START + 10);
        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(relayer);
        escrow.closeSales(id);
        assertEq(escrow.getCampaign(id).salesClose, START, "never moved later");
    }

    function test_closeSales_revertsAtAndAfterSalesClose() public {
        uint64 id = _createJoe();

        vm.warp(salesClose);
        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(relayer);
        escrow.closeSales(id);

        vm.warp(salesClose + 1 days);
        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(relayer);
        escrow.closeSales(id);

        assertEq(escrow.getCampaign(id).salesClose, salesClose);
    }

    function testFuzz_closeSales_onlyMovesEarlier(uint64 elapsed) public {
        uint64 id = _createJoe();
        elapsed = uint64(bound(elapsed, 0, 3 days));
        vm.warp(START + elapsed);

        vm.prank(relayer);
        if (START + elapsed >= salesClose) {
            vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
            escrow.closeSales(id);
            assertEq(escrow.getCampaign(id).salesClose, salesClose);
        } else {
            escrow.closeSales(id);
            assertEq(escrow.getCampaign(id).salesClose, START + elapsed);
            assertLt(escrow.getCampaign(id).salesClose, salesClose);
        }
    }
}
