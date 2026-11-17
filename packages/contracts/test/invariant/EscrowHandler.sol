// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {IWinzEscrow} from "../../src/interfaces/IWinzEscrow.sol";
import {WinzEscrow} from "../../src/WinzEscrow.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";

/// @notice Bounded actions over a WinzEscrow for the invariant campaign.
/// @dev The handler never asserts: with `fail_on_revert = false` a failed assertion would revert the
///      call and be discarded like any other revert. A broken post-condition is stored in
///      `violation` instead, and an invariant checks that it stays empty. A call that reverts in the
///      escrow rolls back the ghost updates of that call with it, so ghosts only describe calls that
///      went through.
contract EscrowHandler is CommonBase, StdCheats, StdUtils {
    uint256 internal constant MAX_CAMPAIGNS = 12;
    uint128 internal constant ONE = 1e6;

    WinzEscrow public immutable escrow;
    TestUSDC public immutable usdc;
    address public immutable relayer;
    address public immutable oracle;
    address public immutable treasury;
    uint256 internal immutable oracleKey;

    address[] public merchants;
    address[] public buyers;

    struct CampaignGhost {
        address merchant;
        bytes32 instrument;
        uint128 unitPrice;
        uint16 refundBps;
        uint64 salesClose;
        uint256 charged; // sum of the amounts charged to its tickets
    }

    struct TicketGhost {
        uint64 campaignId;
        address buyer;
        uint128 paid;
        uint128 refundable;
        uint128 maxHedgeCost;
        bool viaTreasury;
    }

    mapping(uint64 id => CampaignGhost) public campaignGhost;
    mapping(uint256 ticketId => TicketGhost) public ticketGhost;

    /// @notice Tokens sent straight to the escrow, outside any function.
    uint256 public donated;
    /// @notice Treasury balance when the handler was set up.
    uint256 public treasuryStart;
    /// @notice Paid by the treasury to merchants through payMerchant.
    uint256 public merchantPaid;
    /// @notice First broken post-condition seen, empty if none.
    string public violation;

    mapping(bytes32 action => uint256) public calls;
    uint256 internal nonce;

    /// @dev What an action would like its campaign or ticket to be. Three times out of four the
    ///      handler looks for one that fits, so that sequences go deep; one time out of four it
    ///      takes whatever the seed designates, so that refusals are exercised too.
    enum Want {
        Any,
        Selling, // live and before salesClose
        Unsettled, // not settled, budget not released
        Settleable, // not settled, before the emergency window (sales may still be open)
        PastClose, // not settled, past salesClose, before the emergency window
        SettledYes,
        Due, // merchantDue > 0
        Releasable, // settled, not released
        Emergency // not settled, emergency window open, budget not released
    }

    enum WantTicket {
        Any,
        Uncharged, // hedge not charged, campaign still chargeable
        Claimable // not paid out, campaign in its emergency window
    }

    constructor(WinzEscrow escrow_, TestUSDC usdc_, uint256 oracleKey_) {
        escrow = escrow_;
        usdc = usdc_;
        relayer = escrow_.relayer();
        oracle = escrow_.oracle();
        treasury = escrow_.treasury();
        oracleKey = oracleKey_;
        for (uint256 i; i < 3; ++i) {
            merchants.push(address(uint160(0xA11CE000 + i)));
        }
        for (uint256 i; i < 5; ++i) {
            buyers.push(address(uint160(0xB0B00000 + i)));
        }
    }

    /// @dev Called once by the test after the treasury has been funded.
    function start() external {
        treasuryStart = usdc.balanceOf(treasury);
    }

    function merchantCount() external view returns (uint256) {
        return merchants.length;
    }

    function buyerCount() external view returns (uint256) {
        return buyers.length;
    }

    function callCount(string calldata action) external view returns (uint256) {
        return calls[keccak256(bytes(action))];
    }

    // ----------------------------------------------------------------------------------------------
    // Relayer actions
    // ----------------------------------------------------------------------------------------------

    function createCampaign(
        uint256 merchantSeed,
        uint128 unitPrice,
        uint16 refundBps,
        uint64 closeIn,
        uint128 budget
    ) external {
        if (escrow.campaignCount() >= MAX_CAMPAIGNS) return;
        address merchant = merchants[merchantSeed % merchants.length];
        IWinzEscrow.CampaignParams memory params = IWinzEscrow.CampaignParams({
            instrument: bytes32(merchantSeed % 2), // two instruments, shared between merchants
            salesClose: uint64(block.timestamp + bound(closeIn, 6 hours, 4 days)),
            unitPrice: uint128(bound(unitPrice, 1, 100 * ONE)),
            refundBps: uint16(bound(refundBps, 1, 10_000))
        });
        budget = uint128(bound(budget, 0, 500 * ONE));

        vm.prank(relayer);
        uint64 id = escrow.createCampaignFor(merchant, params, budget);

        campaignGhost[id] = CampaignGhost({
            merchant: merchant,
            instrument: params.instrument,
            unitPrice: params.unitPrice,
            refundBps: params.refundBps,
            salesClose: params.salesClose,
            charged: 0
        });
        _count("createCampaign");
    }

    function topUp(uint256 campaignSeed, uint128 amount) external {
        uint64 id = _campaign(campaignSeed, Want.Unsettled);
        if (id == 0) return;
        vm.prank(relayer);
        escrow.topUpBudgetFor(id, uint128(bound(amount, 1, 100 * ONE)));
        _count("topUp");
    }

    function buyFor(uint256 campaignSeed, uint256 buyerSeed, uint32 qty, uint128 maxHedgeCost) external {
        uint64 id = _campaign(campaignSeed, Want.Selling);
        if (id == 0) return;
        (IWinzEscrow.Quote memory q, bytes memory sig) = _signedQuote(id, buyerSeed, qty, maxHedgeCost);
        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        uint256 treasuryBefore = usdc.balanceOf(treasury);
        uint256 merchantBefore = usdc.balanceOf(c.merchant);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.prank(relayer);
        uint256 ticketId = escrow.buyFor(q, sig);

        _recordTicket(ticketId, true);
        TicketGhost memory t = ticketGhost[ticketId];
        if (!_fell(treasuryBefore, usdc.balanceOf(treasury), t.paid)) {
            _violate("buyFor: treasury did not pay `paid`");
        }
        if (!_rose(merchantBefore, usdc.balanceOf(c.merchant), t.paid - t.refundable)) {
            _violate("buyFor: merchant did not get paid - refundable");
        }
        if (!_rose(escrowBefore, usdc.balanceOf(address(escrow)), t.refundable)) {
            _violate("buyFor: escrow did not get refundable");
        }
        _count("buyFor");
    }

    function buyDirect(uint256 campaignSeed, uint256 buyerSeed, uint32 qty, uint128 maxHedgeCost) external {
        uint64 id = _campaign(campaignSeed, Want.Selling);
        if (id == 0) return;
        (IWinzEscrow.Quote memory q, bytes memory sig) = _signedQuote(id, buyerSeed, qty, maxHedgeCost);
        uint256 price = uint256(q.qty) * escrow.getCampaign(id).unitPrice;
        // The buyer is given exactly the price, so a buyer's balance only ever holds refunds.
        usdc.mint(q.buyer, price);
        vm.prank(q.buyer);
        usdc.approve(address(escrow), price);

        vm.prank(q.buyer);
        uint256 ticketId = escrow.buy(q, sig);

        _recordTicket(ticketId, false);
        _count("buyDirect");
    }

    function setPaused(uint256 campaignSeed, bool paused) external {
        uint64 id = _campaign(campaignSeed, Want.Any);
        if (id == 0) return;
        vm.prank(relayer);
        escrow.setPaused(id, paused);
        _count("setPaused");
    }

    function closeSales(uint256 campaignSeed) external {
        // Rare on purpose: a closed campaign sells nothing more.
        if ((campaignSeed >> 64) % 4 != 0) return;
        uint64 id = _campaign(campaignSeed, Want.Selling);
        if (id == 0) return;
        vm.prank(relayer);
        escrow.closeSales(id);

        uint64 newClose = escrow.getCampaign(id).salesClose;
        if (newClose >= campaignGhost[id].salesClose) {
            _violate("closeSales: salesClose did not move earlier");
        }
        campaignGhost[id].salesClose = newClose;
        _count("closeSales");
    }

    // ----------------------------------------------------------------------------------------------
    // Oracle actions
    // ----------------------------------------------------------------------------------------------

    function chargeHedge(uint256 ticketSeed, uint128 amount) external {
        uint256 ticketId = _ticket(ticketSeed, WantTicket.Uncharged);
        if (ticketId == 0) return;
        TicketGhost memory t = ticketGhost[ticketId];
        // One time in eight, try to charge above the guarantee: the escrow must refuse.
        uint128 ceiling = ticketSeed % 8 == 7 ? t.maxHedgeCost + ONE : t.maxHedgeCost;
        amount = uint128(bound(amount, 0, ceiling));

        uint256[] memory ids = new uint256[](1);
        uint128[] memory amounts = new uint128[](1);
        ids[0] = ticketId;
        amounts[0] = amount;
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(oracle);
        escrow.chargeHedge(ids, amounts);

        if (amount > t.maxHedgeCost) _violate("chargeHedge: charged above the guarantee");
        if (!_rose(treasuryBefore, usdc.balanceOf(treasury), amount)) {
            _violate("chargeHedge: treasury delta");
        }
        campaignGhost[t.campaignId].charged += amount;
        _count("chargeHedge");
    }

    function chargeAll(uint256 campaignSeed, uint256 seed) external {
        uint64 id = _campaign(campaignSeed, Want.Unsettled);
        if (id == 0) return;
        _chargeAll(id, seed);
        _count("chargeAll");
    }

    function settle(uint256 campaignSeed, uint8 outcomeSeed) external {
        uint64 id = _campaign(campaignSeed, Want.PastClose);
        if (id == 0) return;
        _settle(id, outcomeSeed);
        _count("settle");
    }

    /// @dev The whole regular path in one action, so that settled states are reached often: wait for
    ///      salesClose if needed, charge what is left, settle.
    function closeChargeSettle(uint256 campaignSeed, uint256 seed, uint8 outcomeSeed) external {
        uint64 id = _campaign(campaignSeed, Want.Settleable);
        if (id == 0) return;
        if (block.timestamp < escrow.getCampaign(id).salesClose) {
            // Still selling: end the sales now rather than jumping ahead, which would close every
            // other campaign too.
            vm.prank(relayer);
            escrow.closeSales(id);
            campaignGhost[id].salesClose = uint64(block.timestamp);
        }
        _chargeAll(id, seed);
        _settle(id, outcomeSeed);
        _count("closeChargeSettle");
    }

    // ----------------------------------------------------------------------------------------------
    // Anyone
    // ----------------------------------------------------------------------------------------------

    function payMerchant(uint256 campaignSeed, address caller) external {
        uint64 id = _campaign(campaignSeed, Want.Due);
        if (id == 0) return;
        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        uint256 merchantBefore = usdc.balanceOf(c.merchant);
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(caller);
        escrow.payMerchant(id);

        if (!_rose(merchantBefore, usdc.balanceOf(c.merchant), c.merchantDue)) {
            _violate("payMerchant: merchant delta");
        }
        if (!_fell(treasuryBefore, usdc.balanceOf(treasury), c.merchantDue)) {
            _violate("payMerchant: treasury delta");
        }
        merchantPaid += c.merchantDue;
        _count("payMerchant");
    }

    function refundBatch(uint256 campaignSeed, uint256 mask, address caller) external {
        uint64 id = _campaign(campaignSeed, Want.SettledYes);
        if (id == 0) return;
        // Every ticket whose bit is set, whatever its campaign: foreign ones must be skipped.
        uint256 total = escrow.ticketCount();
        uint256[] memory ids = new uint256[](total + 1);
        uint256 n;
        for (uint256 ticketId = 1; ticketId <= total; ++ticketId) {
            if (mask >> (ticketId % 256) & 1 == 1) ids[n++] = ticketId;
        }
        ids[n++] = total + 1 + mask % 3; // and an id that does not exist
        assembly ("memory-safe") {
            mstore(ids, n)
        }
        uint256 lockedBefore = escrow.getCampaign(id).lockedRefunds;
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.prank(caller);
        escrow.refundBatch(id, ids);

        uint256 lockedAfter = escrow.getCampaign(id).lockedRefunds;
        if (
            lockedAfter > lockedBefore
                || !_fell(escrowBefore, usdc.balanceOf(address(escrow)), lockedBefore - lockedAfter)
        ) {
            _violate("refundBatch: escrow outflow != lockedRefunds decrease");
        }
        _count("refundBatch");
    }

    function release(uint256 campaignSeed, address caller) external {
        uint64 id = _campaign(campaignSeed, Want.Releasable);
        if (id == 0) return;
        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        uint256 expected = c.hedgeBudget - c.hedgeSpent;
        if (c.status != IWinzEscrow.Status.SettledYes) expected += c.lockedRefunds;
        uint256 merchantBefore = usdc.balanceOf(c.merchant);

        vm.prank(caller);
        escrow.release(id);

        if (!_rose(merchantBefore, usdc.balanceOf(c.merchant), expected)) {
            _violate("release: merchant delta");
        }
        _count("release");
    }

    function emergencyClaim(uint256 ticketSeed, address caller) external {
        uint256 ticketId = _ticket(ticketSeed, WantTicket.Claimable);
        if (ticketId == 0) return;
        TicketGhost memory t = ticketGhost[ticketId];
        uint256 buyerBefore = usdc.balanceOf(t.buyer);

        vm.prank(caller);
        escrow.emergencyClaim(ticketId);

        if (!_rose(buyerBefore, usdc.balanceOf(t.buyer), t.refundable)) {
            _violate("emergencyClaim: buyer delta");
        }
        _count("emergencyClaim");
    }

    function emergencyReleaseBudget(uint256 campaignSeed, address caller) external {
        uint64 id = _campaign(campaignSeed, Want.Emergency);
        if (id == 0) return;
        IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
        uint256 merchantBefore = usdc.balanceOf(c.merchant);

        vm.prank(caller);
        escrow.emergencyReleaseBudget(id);

        if (!_rose(merchantBefore, usdc.balanceOf(c.merchant), c.hedgeBudget - c.hedgeSpent)) {
            _violate("emergencyReleaseBudget: merchant delta");
        }
        _count("emergencyReleaseBudget");
    }

    // ----------------------------------------------------------------------------------------------
    // Environment
    // ----------------------------------------------------------------------------------------------

    function warp(uint32 delta) external {
        vm.warp(block.timestamp + bound(delta, 1, 3 hours));
        _count("warp");
    }

    function warpToEmergency(uint256 campaignSeed) external {
        // Rare on purpose: the jump opens the emergency window of every campaign created so far.
        if ((campaignSeed >> 64) % 4 != 0) return;
        uint64 id = _campaign(campaignSeed, Want.Unsettled);
        if (id == 0) return;
        uint256 target = uint256(escrow.getCampaign(id).salesClose) + escrow.EMERGENCY_DELAY();
        if (block.timestamp >= target) return;
        vm.warp(target);
        _count("warpToEmergency");
    }

    function toggleBlocked(uint256 buyerSeed) external {
        address buyer = buyers[buyerSeed % buyers.length];
        usdc.setBlocked(buyer, !usdc.blocked(buyer));
        _count("toggleBlocked");
    }

    function donate(uint64 amount) external {
        uint256 value = bound(amount, 1, 10 * ONE);
        usdc.mint(address(this), value);
        usdc.transfer(address(escrow), value);
        donated += value;
        _count("donate");
    }

    // ----------------------------------------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------------------------------------

    function _campaign(uint256 seed, Want want) internal view returns (uint64) {
        uint64 count = escrow.campaignCount();
        if (count == 0) return 0;
        uint64 first = uint64(seed) % count + 1; // the low 64 bits choose, bits 128+ set the mode
        if (want == Want.Any || (seed >> 128) % 4 == 3) return first;
        for (uint64 i; i < count; ++i) {
            uint64 id = (first - 1 + i) % count + 1;
            if (_fits(escrow.getCampaign(id), want)) return id;
        }
        return first;
    }

    function _fits(IWinzEscrow.Campaign memory c, Want want) internal view returns (bool) {
        bool settled = c.status != IWinzEscrow.Status.Live && c.status != IWinzEscrow.Status.Paused;
        bool emergency = block.timestamp >= uint256(c.salesClose) + escrow.EMERGENCY_DELAY();
        if (want == Want.Selling) {
            return c.status == IWinzEscrow.Status.Live && block.timestamp < c.salesClose;
        }
        if (want == Want.Unsettled) return !settled && !c.released;
        if (want == Want.Settleable) return !settled && !emergency;
        if (want == Want.PastClose) return !settled && !emergency && block.timestamp >= c.salesClose;
        if (want == Want.SettledYes) {
            return c.status == IWinzEscrow.Status.SettledYes && c.lockedRefunds != 0;
        }
        if (want == Want.Due) return c.merchantDue != 0;
        if (want == Want.Releasable) return settled && !c.released;
        return !settled && emergency && !c.released; // Want.Emergency
    }

    function _ticket(uint256 seed, WantTicket want) internal view returns (uint256) {
        uint256 count = escrow.ticketCount();
        if (count == 0) return 0;
        uint256 first = uint64(seed) % count + 1;
        if (want == WantTicket.Any || (seed >> 128) % 4 == 3) return first;
        for (uint256 i; i < count; ++i) {
            uint256 ticketId = (first - 1 + i) % count + 1;
            IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
            IWinzEscrow.Campaign memory c = escrow.getCampaign(t.campaignId);
            if (want == WantTicket.Uncharged) {
                if (!t.hedgeCharged && _fits(c, Want.Unsettled)) return ticketId;
            } else if (!t.paidOut && block.timestamp >= uint256(c.salesClose) + escrow.EMERGENCY_DELAY()) {
                if (c.status == IWinzEscrow.Status.Live || c.status == IWinzEscrow.Status.Paused) {
                    return ticketId;
                }
            }
        }
        return first;
    }

    function _signedQuote(uint64 id, uint256 buyerSeed, uint32 qty, uint128 maxHedgeCost)
        internal
        returns (IWinzEscrow.Quote memory q, bytes memory sig)
    {
        uint128 available = escrow.availableBudget(id);
        q = IWinzEscrow.Quote({
            campaignId: id,
            buyer: buyers[buyerSeed % buyers.length],
            qty: uint32(bound(qty, 1, 5)),
            // Mostly within the budget; one time in eight, possibly above it.
            maxHedgeCost: uint128(bound(maxHedgeCost, 0, buyerSeed % 8 == 7 ? available + ONE : available)),
            expiry: uint64(block.timestamp + 60),
            nonce: ++nonce
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, escrow.quoteDigest(q));
        sig = abi.encodePacked(r, s, v);
    }

    function _recordTicket(uint256 ticketId, bool viaTreasury) internal {
        IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
        ticketGhost[ticketId] = TicketGhost({
            campaignId: t.campaignId,
            buyer: t.buyer,
            paid: t.paid,
            refundable: t.refundable,
            maxHedgeCost: t.maxHedgeCost,
            viaTreasury: viaTreasury
        });
    }

    function _chargeAll(uint64 id, uint256 seed) internal {
        uint256 total = escrow.ticketCount();
        uint256[] memory ids = new uint256[](total);
        uint128[] memory amounts = new uint128[](total);
        uint256 n;
        uint256 sum;
        for (uint256 ticketId = 1; ticketId <= total; ++ticketId) {
            IWinzEscrow.Ticket memory t = escrow.getTicket(ticketId);
            if (t.campaignId != id || t.hedgeCharged) continue;
            ids[n] = ticketId;
            amounts[n] =
                uint128(uint256(keccak256(abi.encode(seed, ticketId))) % (uint256(t.maxHedgeCost) + 1));
            sum += amounts[n];
            ++n;
        }
        assembly ("memory-safe") {
            mstore(ids, n)
            mstore(amounts, n)
        }
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.prank(oracle);
        escrow.chargeHedge(ids, amounts);

        if (!_rose(treasuryBefore, usdc.balanceOf(treasury), sum)) _violate("chargeAll: treasury delta");
        campaignGhost[id].charged += sum;
    }

    function _settle(uint64 id, uint8 outcomeSeed) internal {
        vm.prank(oracle);
        escrow.settle(id, IWinzEscrow.Outcome(outcomeSeed % 3));
    }

    function _count(string memory action) internal {
        ++calls[keccak256(bytes(action))];
    }

    /// @dev True when a balance or counter went from `b` up to `a` by exactly `expected`. A move in the
    ///      wrong direction returns false instead of panicking on `a - b`: with fail_on_revert off,
    ///      the invariant campaign would discard that revert and the violation would go unseen.
    function _rose(uint256 b, uint256 a, uint256 expected) internal pure returns (bool) {
        return a >= b && a - b == expected;
    }

    /// @dev True when it went from `b` down to `a` by exactly `expected`; see `_rose`.
    function _fell(uint256 b, uint256 a, uint256 expected) internal pure returns (bool) {
        return b >= a && b - a == expected;
    }

    function _violate(string memory what) internal {
        if (bytes(violation).length == 0) violation = what;
    }
}
