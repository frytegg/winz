// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {IWinzEscrow} from "../src/interfaces/IWinzEscrow.sol";
import {WinzEscrow} from "../src/WinzEscrow.sol";
import {EscrowFixture} from "./utils/EscrowFixture.sol";

/// @notice buyFor, buy and the quote checks (PR-3, EC-3, EC-5).
contract WinzEscrowPurchaseTest is EscrowFixture {
    uint256 internal constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    // ----------------------------------------------------------------------------------------------
    // buyFor: success
    // ----------------------------------------------------------------------------------------------

    function test_buyFor_fullRefund_locksEverythingAndReservesTheGuarantee() public {
        uint64 id = _createJoe();
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        IWinzEscrow.Quote memory q = _quote(id, maya, 2, 5 * ONE);
        bytes memory sig = _sign(q);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketPurchased(1, id, maya, 2, 40 * ONE, 40 * ONE, 5 * ONE);
        vm.prank(relayer);
        uint256 ticketId = escrow.buyFor(q, sig);

        assertEq(ticketId, 1, "ticket ids start at 1");
        assertEq(escrow.ticketCount(), 1);
        assertTrue(escrow.nonceUsed(q.nonce));

        IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
        assertEq(t.campaignId, id);
        assertEq(t.buyer, maya);
        assertEq(t.paid, 40 * ONE);
        assertEq(t.refundable, 40 * ONE);
        assertEq(t.maxHedgeCost, 5 * ONE);
        assertFalse(t.hedgeCharged);
        assertFalse(t.paidOut);

        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        assertEq(c.hedgeReserved, 5 * ONE);
        assertEq(c.hedgeSpent, 0);
        assertEq(c.lockedRefunds, 40 * ONE);
        assertEq(escrow.availableBudget(id), 995 * ONE);

        assertEq(usdc.balanceOf(treasury), treasuryBefore - 40 * ONE, "the treasury paid the price");
        assertEq(usdc.balanceOf(joe), 0, "R = 100 %: the merchant gets nothing before settlement");
        assertEq(usdc.balanceOf(maya), 0);
        assertEq(usdc.balanceOf(relayer), 0);
        _assertSolvent();
    }

    function test_buyFor_partialRefund_forwardsTheRestToTheMerchant() public {
        uint64 id = _create(joe, 20 * ONE, 2_500, 100 * ONE);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        uint256 ticketId = _buyFor(id, maya, 3, ONE);

        IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
        assertEq(t.paid, 60 * ONE);
        assertEq(t.refundable, 15 * ONE);
        assertEq(usdc.balanceOf(joe), 45 * ONE, "(1 - R) x price goes to the merchant at once");
        assertEq(usdc.balanceOf(address(escrow)), 115 * ONE, "budget + refundable");
        assertEq(usdc.balanceOf(treasury), treasuryBefore - 60 * ONE);
        assertEq(escrow.getCampaign(id).lockedRefunds, 15 * ONE);
        _assertSolvent();
    }

    function test_buyFor_refundableRoundsDown_merchantKeepsTheDust() public {
        // 3 micro-USDC at 33.33 %: 0.9999 micro-USDC refundable, rounded down to 0.
        uint64 id = _create(joe, 3, 3_333, 0);
        uint256 ticketId = _buyFor(id, maya, 1, 0);
        IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
        assertEq(t.paid, 3);
        assertEq(t.refundable, 0);
        assertEq(usdc.balanceOf(joe), 3);

        // 7 units of 3 micro-USDC: 21 x 0.3333 = 6.9993, rounded down to 6.
        ticketId = _buyFor(id, maya, 7, 0);
        t = escrow.getTicket(ticketId);
        assertEq(t.paid, 21);
        assertEq(t.refundable, 6);
        assertEq(usdc.balanceOf(joe), 3 + 15);
        assertEq(escrow.getCampaign(id).lockedRefunds, 6);
        _assertSolvent();
    }

    function testFuzz_buyFor_splitsThePrice(uint128 unitPrice, uint16 refundBps, uint32 qty) public {
        unitPrice = uint128(bound(unitPrice, 1, 10_000 * ONE));
        refundBps = uint16(bound(refundBps, 1, 10_000));
        qty = uint32(bound(qty, 1, 1_000));
        usdc.mint(treasury, uint256(unitPrice) * qty);

        uint64 id = _create(joe, unitPrice, refundBps, 0);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 ticketId = _buyFor(id, maya, qty, 0);

        uint256 paid = uint256(unitPrice) * qty;
        uint256 refundable = paid * refundBps / 10_000;
        IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
        assertEq(t.paid, paid);
        assertEq(t.refundable, refundable);
        assertLe(t.refundable, t.paid);
        assertEq(usdc.balanceOf(address(escrow)), refundable);
        assertEq(usdc.balanceOf(joe), paid - refundable);
        assertEq(usdc.balanceOf(treasury), treasuryBefore - paid);
        _assertSolvent();
    }

    function test_buyFor_ticketIdsAreGlobal() public {
        uint64 a = _createJoe();
        uint64 b = _create(ana, 5 * ONE, 5_000, 10 * ONE);
        assertEq(_buyFor(a, maya, 1, 0), 1);
        assertEq(_buyFor(b, liam, 1, 0), 2);
        assertEq(_buyFor(a, zoe, 1, 0), 3);
        assertEq(escrow.getTicket(2).campaignId, b);
        assertEq(escrow.ticketCount(), 3);
    }

    function test_buyFor_zeroGuaranteeOnZeroBudget() public {
        uint64 id = _create(joe, 20 * ONE, 10_000, 0);
        uint256 ticketId = _buyFor(id, maya, 1, 0);
        assertEq(escrow.getTicket(ticketId).maxHedgeCost, 0);
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // buyFor: access and quote shape
    // ----------------------------------------------------------------------------------------------

    function test_buyFor_revertsForNonRelayer() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);

        address[6] memory callers = [owner, oracle, treasury, joe, maya, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IWinzEscrow.Unauthorized.selector);
            vm.prank(callers[i]);
            escrow.buyFor(q, sig);
        }

        // Positive control: the same quote goes through from the relayer.
        vm.prank(relayer);
        assertEq(escrow.buyFor(q, sig), 1);
    }

    function test_buyFor_revertsForUnknownCampaign() public {
        _createJoe();
        IWinzEscrow.Quote memory q = _quote(2, maya, 1, ONE);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.CampaignNotFound.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
    }

    function test_buyFor_revertsOnZeroQty() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 0, ONE);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
    }

    function test_buyFor_revertsOnZeroBuyer() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, address(0), 1, ONE);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
    }

    function test_buyFor_revertsWhenThePriceOverflowsUint128() public {
        uint64 id = _create(joe, type(uint128).max, 10_000, 0);
        IWinzEscrow.Quote memory q = _quote(id, maya, 2, 0);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.InvalidParams.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
        assertFalse(escrow.nonceUsed(q.nonce));
    }

    // ----------------------------------------------------------------------------------------------
    // Quote: expiry, nonce, signature
    // ----------------------------------------------------------------------------------------------

    function test_buyFor_revertsOnExpiredQuote() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);

        vm.warp(q.expiry + 1);
        vm.expectRevert(IWinzEscrow.QuoteExpired.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
        assertEq(escrow.ticketCount(), 0);
    }

    function test_buyFor_acceptsQuoteAtExactlyItsExpiry() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);

        vm.warp(q.expiry);
        vm.prank(relayer);
        assertEq(escrow.buyFor(q, sig), 1);
    }

    function test_buyFor_revertsOnReplayedQuote() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);

        assertFalse(escrow.nonceUsed(q.nonce));
        vm.prank(relayer);
        escrow.buyFor(q, sig);
        assertTrue(escrow.nonceUsed(q.nonce));

        vm.expectRevert(IWinzEscrow.QuoteNonceUsed.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
        assertEq(escrow.ticketCount(), 1);
        _assertSolvent();
    }

    function test_buyFor_revertsOnReusedNonce_evenWithAFreshSignature() public {
        uint64 a = _createJoe();
        uint64 b = _create(ana, 5 * ONE, 5_000, 10 * ONE);
        IWinzEscrow.Quote memory first = _quote(a, maya, 1, ONE);
        bytes memory firstSig = _sign(first);
        vm.prank(relayer);
        escrow.buyFor(first, firstSig);

        // Another campaign, another buyer, properly signed, same nonce.
        IWinzEscrow.Quote memory second = _quote(b, liam, 2, 0);
        second.nonce = first.nonce;
        bytes memory secondSig = _sign(second);
        vm.expectRevert(IWinzEscrow.QuoteNonceUsed.selector);
        vm.prank(relayer);
        escrow.buyFor(second, secondSig);

        // Positive control: the same quote with an unused nonce passes.
        second.nonce = nextNonce++;
        secondSig = _sign(second);
        vm.prank(relayer);
        assertEq(escrow.buyFor(second, secondSig), 2);
    }

    function test_buyFor_revertsOnWrongSigner() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        (, uint256 otherKey) = makeAddrAndKey("notTheOracle");
        bytes memory badSig = _signDigest(_digest(q), otherKey);

        vm.expectRevert(IWinzEscrow.QuoteBadSignature.selector);
        vm.prank(relayer);
        escrow.buyFor(q, badSig);

        // Positive control: the oracle's signature over the same quote passes.
        bytes memory goodSig = _sign(q);
        vm.prank(relayer);
        assertEq(escrow.buyFor(q, goodSig), 1);
    }

    function test_buyFor_revertsWhenAnyQuoteFieldIsTampered() public {
        uint64 id = _createJoe();
        _create(ana, 20 * ONE, 10_000, 1_000 * ONE);
        IWinzEscrow.Quote memory signed = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(signed);

        IWinzEscrow.Quote memory q = _copy(signed);
        q.campaignId = 2;
        _expectBadSignature(q, sig);

        q = _copy(signed);
        q.buyer = liam;
        _expectBadSignature(q, sig);

        q = _copy(signed);
        q.qty = 2;
        _expectBadSignature(q, sig);

        q = _copy(signed);
        q.maxHedgeCost = 0;
        _expectBadSignature(q, sig);

        q = _copy(signed);
        q.expiry = signed.expiry + 1 days;
        _expectBadSignature(q, sig);

        q = _copy(signed);
        q.nonce = signed.nonce + 1;
        _expectBadSignature(q, sig);

        // Positive control: the untouched quote passes with the very same signature.
        vm.prank(relayer);
        assertEq(escrow.buyFor(signed, sig), 1);
    }

    function test_buyFor_revertsOnMalformedSignatures() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes32 digest = _digest(q);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, digest);

        // Empty, 64 bytes (ERC-2098 short form), 66 bytes.
        _expectBadSignature(q, "");
        _expectBadSignature(q, abi.encodePacked(r, s));
        _expectBadSignature(q, abi.encodePacked(r, s, v, uint8(0)));
        // Invalid recovery id.
        _expectBadSignature(q, abi.encodePacked(r, s, uint8(29)));
        // Malleable twin (high s, flipped v): a valid ECDSA signature that OpenZeppelin refuses.
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        assertEq(ecrecover(digest, flippedV, r, highS), oracle, "the twin does recover to the oracle");
        _expectBadSignature(q, abi.encodePacked(r, highS, flippedV));

        // Positive control.
        vm.prank(relayer);
        assertEq(escrow.buyFor(q, abi.encodePacked(r, s, v)), 1);
    }

    function test_buyFor_revertsOnSignatureForAnotherContractOrChain() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);

        WinzEscrow other = new WinzEscrow(address(usdc), relayer, oracle, treasury, owner);
        bytes memory otherContractSig = _signDigest(_digestFor(q, address(other), block.chainid), oracleKey);
        _expectBadSignature(q, otherContractSig);

        bytes memory otherChainSig = _signDigest(_digestFor(q, address(escrow), block.chainid + 1), oracleKey);
        _expectBadSignature(q, otherChainSig);

        // Positive control.
        bytes memory sig = _sign(q);
        vm.prank(relayer);
        assertEq(escrow.buyFor(q, sig), 1);
    }

    // ----------------------------------------------------------------------------------------------
    // Campaign state: pause, salesClose, settlement, budget
    // ----------------------------------------------------------------------------------------------

    function test_buyFor_revertsWhilePaused_andPassesOnceResumed() public {
        uint64 id = _createJoe();
        vm.prank(relayer);
        escrow.setPaused(id, true);

        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.SalesArePaused.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
        assertFalse(escrow.nonceUsed(q.nonce), "a refused quote is not consumed");

        vm.prank(relayer);
        escrow.setPaused(id, false);
        vm.prank(relayer);
        assertEq(escrow.buyFor(q, sig), 1);
    }

    function test_buyFor_revertsFromSalesCloseOn() public {
        uint64 id = _createJoe();

        vm.warp(salesClose);
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);

        vm.warp(salesClose + 1 hours);
        q = _quote(id, maya, 1, ONE);
        sig = _sign(q);
        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
        assertEq(escrow.ticketCount(), 0);
    }

    function test_buyFor_passesOneSecondBeforeSalesClose() public {
        uint64 id = _createJoe();
        vm.warp(salesClose - 1);
        assertEq(_buyFor(id, maya, 1, ONE), 1);
    }

    function test_buyFor_revertsOnceSettled() public {
        uint64 id = _createJoe();
        _closeAndSettle(id, IWinzEscrow.Outcome.No);

        IWinzEscrow.Quote memory q = _quote(id, maya, 1, 0);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.AlreadySettled.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
    }

    function test_buyFor_revertsWhenGuaranteeExceedsAvailableBudget() public {
        uint64 id = _create(joe, 20 * ONE, 10_000, 10 * ONE);

        IWinzEscrow.Quote memory q = _quote(id, maya, 1, 10 * ONE + 1);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.BudgetExceeded.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);

        // Positive control: exactly the available budget passes.
        assertEq(_buyFor(id, maya, 1, 10 * ONE), 1);
        assertEq(escrow.availableBudget(id), 0);
    }

    /// @dev EC-5: reservations stack, so two sales cannot commit the same budget.
    function test_buyFor_reservationsStack_andUnusedReservationComesBack() public {
        uint64 id = _create(joe, 20 * ONE, 10_000, 10 * ONE);
        uint256 first = _buyFor(id, maya, 1, 6 * ONE);

        IWinzEscrow.Quote memory q = _quote(id, liam, 1, 5 * ONE);
        bytes memory sig = _sign(q);
        vm.expectRevert(IWinzEscrow.BudgetExceeded.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);

        // The engine hedged the first sale for 4 instead of 6: 2 return to the budget (4 + 2 = 6 free).
        _charge(first, 4 * ONE);
        assertEq(escrow.availableBudget(id), 6 * ONE);

        vm.prank(relayer);
        assertEq(escrow.buyFor(q, sig), 2);
        assertEq(escrow.availableBudget(id), ONE);
        _assertSolvent();
    }

    function test_buyFor_passesAfterTopUp() public {
        uint64 id = _create(joe, 20 * ONE, 10_000, ONE);
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, 3 * ONE);
        bytes memory sig = _sign(q);

        vm.expectRevert(IWinzEscrow.BudgetExceeded.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);

        vm.prank(relayer);
        escrow.topUpBudgetFor(id, 2 * ONE);
        vm.prank(relayer);
        assertEq(escrow.buyFor(q, sig), 1);
        _assertSolvent();
    }

    function test_buyFor_revertsWhenTreasuryCannotPay_andLeavesNoTrace() public {
        uint64 id = _createJoe();
        uint256 balance = usdc.balanceOf(treasury);
        vm.prank(treasury);
        usdc.transfer(stranger, balance - 19 * ONE);

        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, treasury, 19 * ONE, 20 * ONE
            )
        );
        vm.prank(relayer);
        escrow.buyFor(q, sig);

        assertFalse(escrow.nonceUsed(q.nonce));
        assertEq(escrow.ticketCount(), 0);
        assertEq(escrow.getCampaign(id).hedgeReserved, 0);
        assertEq(escrow.getCampaign(id).lockedRefunds, 0);

        // Positive control: once funded, the same quote passes.
        usdc.mint(treasury, ONE);
        vm.prank(relayer);
        assertEq(escrow.buyFor(q, sig), 1);
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // buy (direct path, CO-5)
    // ----------------------------------------------------------------------------------------------

    function test_buy_isPaidByTheBuyer() public {
        uint64 id = _create(joe, 20 * ONE, 5_000, 100 * ONE);
        usdc.mint(maya, 50 * ONE);
        vm.prank(maya);
        usdc.approve(address(escrow), 40 * ONE);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        IWinzEscrow.Quote memory q = _quote(id, maya, 2, 4 * ONE);
        bytes memory sig = _sign(q);

        vm.expectEmit(address(escrow));
        emit IWinzEscrow.TicketPurchased(1, id, maya, 2, 40 * ONE, 20 * ONE, 4 * ONE);
        vm.prank(maya);
        uint256 ticketId = escrow.buy(q, sig);

        assertEq(ticketId, 1);
        assertEq(escrow.getTicket(ticketId).buyer, maya);
        assertEq(usdc.balanceOf(maya), 10 * ONE, "the buyer paid");
        assertEq(usdc.balanceOf(treasury), treasuryBefore, "the treasury did not");
        assertEq(usdc.balanceOf(joe), 20 * ONE);
        assertEq(escrow.getCampaign(id).hedgeReserved, 4 * ONE);
        _assertSolvent();
    }

    function test_buy_revertsWhenCallerIsNotTheQuoteBuyer() public {
        uint64 id = _createJoe();
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);
        usdc.mint(maya, 20 * ONE);
        vm.prank(maya);
        usdc.approve(address(escrow), 20 * ONE);

        address[3] memory callers = [liam, relayer, treasury];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(IWinzEscrow.QuoteMismatch.selector);
            vm.prank(callers[i]);
            escrow.buy(q, sig);
        }

        // Positive control: the quote's buyer can use it.
        vm.prank(maya);
        assertEq(escrow.buy(q, sig), 1);
    }

    function test_buy_revertsWithoutAllowance() public {
        uint64 id = _createJoe();
        usdc.mint(maya, 20 * ONE);
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        bytes memory sig = _sign(q);

        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(escrow), 0, 20 * ONE
            )
        );
        vm.prank(maya);
        escrow.buy(q, sig);
    }

    function test_buy_appliesTheSameQuoteChecks() public {
        uint64 id = _createJoe();
        usdc.mint(maya, 100 * ONE);
        vm.prank(maya);
        usdc.approve(address(escrow), type(uint256).max);

        // Wrong signer.
        IWinzEscrow.Quote memory q = _quote(id, maya, 1, ONE);
        (, uint256 mayaKey) = makeAddrAndKey("maya");
        bytes memory selfSigned = _signDigest(_digest(q), mayaKey);
        vm.expectRevert(IWinzEscrow.QuoteBadSignature.selector);
        vm.prank(maya);
        escrow.buy(q, selfSigned);

        // Replay.
        bytes memory sig = _sign(q);
        vm.prank(maya);
        escrow.buy(q, sig);
        vm.expectRevert(IWinzEscrow.QuoteNonceUsed.selector);
        vm.prank(maya);
        escrow.buy(q, sig);

        // A quote used directly cannot be replayed by the relayer either.
        vm.expectRevert(IWinzEscrow.QuoteNonceUsed.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);

        // Expired.
        q = _quote(id, maya, 1, ONE);
        sig = _sign(q);
        vm.warp(q.expiry + 1);
        vm.expectRevert(IWinzEscrow.QuoteExpired.selector);
        vm.prank(maya);
        escrow.buy(q, sig);

        // Paused.
        vm.prank(relayer);
        escrow.setPaused(id, true);
        q = _quote(id, maya, 1, ONE);
        sig = _sign(q);
        vm.expectRevert(IWinzEscrow.SalesArePaused.selector);
        vm.prank(maya);
        escrow.buy(q, sig);

        // After salesClose.
        vm.prank(relayer);
        escrow.setPaused(id, false);
        vm.warp(salesClose);
        q = _quote(id, maya, 1, ONE);
        sig = _sign(q);
        vm.expectRevert(IWinzEscrow.SalesAreClosed.selector);
        vm.prank(maya);
        escrow.buy(q, sig);

        assertEq(escrow.ticketCount(), 1);
        _assertSolvent();
    }

    // ----------------------------------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------------------------------

    function _copy(IWinzEscrow.Quote memory q) private pure returns (IWinzEscrow.Quote memory) {
        return IWinzEscrow.Quote(q.campaignId, q.buyer, q.qty, q.maxHedgeCost, q.expiry, q.nonce);
    }

    function _expectBadSignature(IWinzEscrow.Quote memory q, bytes memory sig) private {
        vm.expectRevert(IWinzEscrow.QuoteBadSignature.selector);
        vm.prank(relayer);
        escrow.buyFor(q, sig);
    }
}
