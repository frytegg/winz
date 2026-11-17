// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";
import {WinzEscrow} from "../src/WinzEscrow.sol";
import {WeirdToken} from "./mocks/WeirdToken.sol";

/// @notice What WinzEscrow counts as a successful refund transfer, and its reentrancy lock, against a
///         token that misbehaves on `transfer`.
contract WinzEscrowTokenBehaviourTest is Test {
    uint128 internal constant ONE = 1e6;
    uint64 internal constant START = 1_800_000_000;

    WeirdToken internal token;
    WinzEscrow internal escrow;

    address internal relayer = makeAddr("relayer");
    address internal treasury = makeAddr("treasury");
    address internal joe = makeAddr("joe");
    address internal maya = makeAddr("maya");
    address internal liam = makeAddr("liam");
    address internal oracle;
    uint256 internal oracleKey;

    uint64 internal id;
    uint256 internal tMaya;
    uint256 internal tLiam;

    function setUp() public {
        vm.warp(START);
        (oracle, oracleKey) = makeAddrAndKey("oracle");
        token = new WeirdToken();
        escrow = new WinzEscrow(address(token), relayer, oracle, treasury, makeAddr("owner"));
        token.mint(treasury, 1_000 * ONE);
        vm.prank(treasury);
        token.approve(address(escrow), type(uint256).max);

        IWinzEscrow.CampaignParams memory params = IWinzEscrow.CampaignParams({
            instrument: keccak256("X"), salesClose: START + 1 days, unitPrice: 20 * ONE, refundBps: 10_000
        });
        vm.prank(relayer);
        id = escrow.createCampaignFor(joe, params, 10 * ONE);
        tMaya = _buyFor(maya, 1);
        tLiam = _buyFor(liam, 2);
    }

    function _buyFor(address buyer, uint256 nonce) internal returns (uint256 ticketId) {
        IWinzEscrow.Quote memory q = IWinzEscrow.Quote({
            campaignId: id, buyer: buyer, qty: 1, maxHedgeCost: 0, expiry: START + 60, nonce: nonce
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, escrow.quoteDigest(q));
        vm.prank(relayer);
        ticketId = escrow.buyFor(q, abi.encodePacked(r, s, v));
    }

    function _settleYes() internal {
        vm.warp(START + 1 days);
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome.Yes);
    }

    function _both() internal view returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = tMaya;
        ids[1] = tLiam;
    }

    function test_refund_standardReturn_isASuccess() public {
        _settleYes();
        escrow.refundBatch(id, _both());
        assertEq(token.balanceOf(maya), 20 * ONE);
        assertEq(token.balanceOf(liam), 20 * ONE);
        assertEq(escrow.getCampaign(id).lockedRefunds, 0);
    }

    function test_refund_noReturnData_isASuccess() public {
        _settleYes();
        token.setMode(WeirdToken.Mode.NoReturnData);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketRefunded(tMaya, id, maya, 20 * ONE);
        escrow.refundBatch(id, _both());

        assertEq(token.balanceOf(maya), 20 * ONE);
        assertTrue(escrow.getTicket(tMaya).paidOut);
        assertEq(escrow.getCampaign(id).lockedRefunds, 0);
    }

    function test_refund_returningFalse_isAFailure_ticketStaysOwed() public {
        _settleYes();
        token.setMode(WeirdToken.Mode.ReturnsFalse);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.RefundFailed(tMaya, id);
        vm.expectEmit(address(escrow));
        emit IWinzEscrow.RefundFailed(tLiam, id);
        escrow.refundBatch(id, _both());

        assertEq(token.balanceOf(maya), 0);
        assertFalse(escrow.getTicket(tMaya).paidOut);
        assertFalse(escrow.getTicket(tLiam).paidOut);
        assertEq(escrow.getCampaign(id).lockedRefunds, 40 * ONE);

        // Positive control: the same batch pays once the token behaves.
        token.setMode(WeirdToken.Mode.Standard);
        escrow.refundBatch(id, _both());
        assertEq(token.balanceOf(maya), 20 * ONE);
        assertEq(escrow.getCampaign(id).lockedRefunds, 0);
    }

    /// @dev A return value that is neither empty nor `true` cannot be read as a success. The token
    ///      here did move the funds, so this pins the conservative reading only: with a token that
    ///      answers garbage the ticket would stay marked as owed.
    function test_refund_garbageReturn_isNotCountedAsSuccess() public {
        _settleYes();
        token.setMode(WeirdToken.Mode.ReturnsGarbage);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.RefundFailed(tMaya, id);
        escrow.refundBatch(id, _ids(tMaya));

        assertFalse(escrow.getTicket(tMaya).paidOut);
        assertEq(escrow.getCampaign(id).lockedRefunds, 40 * ONE);
    }

    function test_refund_reentrantToken_cannotReenter_andOnlyFailsItsOwnTransfer() public {
        _settleYes();
        token.setMode(WeirdToken.Mode.Reenters);
        token.setReentry(address(escrow), abi.encodeCall(IWinzEscrow.release, (id)));

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.RefundFailed(tMaya, id);
        escrow.refundBatch(id, _ids(tMaya));

        assertFalse(escrow.getCampaign(id).released, "the nested release did not happen");
        assertFalse(escrow.getTicket(tMaya).paidOut);
        assertEq(token.balanceOf(joe), 0);

        // Positive control: outside a refund, the very same call goes through.
        token.setMode(WeirdToken.Mode.Standard);
        escrow.release(id);
        assertTrue(escrow.getCampaign(id).released);
        assertEq(token.balanceOf(joe), 10 * ONE);
    }

    function test_emergencyClaim_reentrantToken_reverts() public {
        vm.warp(START + 1 days + 7 days);
        token.setMode(WeirdToken.Mode.Reenters);
        token.setReentry(address(escrow), abi.encodeCall(IWinzEscrow.emergencyClaim, (tLiam)));

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        escrow.emergencyClaim(tMaya);

        assertFalse(escrow.getTicket(tMaya).paidOut);
        assertFalse(escrow.getTicket(tLiam).paidOut);
        assertEq(escrow.getCampaign(id).lockedRefunds, 40 * ONE);

        // Positive control: without the reentrant call both claims pass.
        token.setMode(WeirdToken.Mode.Standard);
        escrow.emergencyClaim(tMaya);
        escrow.emergencyClaim(tLiam);
        assertEq(token.balanceOf(maya), 20 * ONE);
        assertEq(token.balanceOf(liam), 20 * ONE);
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }
}
