// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWinzEscrow} from "../../src/interfaces/IWinzEscrow.sol";
import {WinzEscrow} from "../../src/WinzEscrow.sol";
import {TestUSDC} from "../../src/mocks/TestUSDC.sol";

/// @notice Shared deployment and helpers for the WinzEscrow unit and scenario tests.
/// @dev The relayer, the oracle, the treasury and the owner are four different addresses here, so a
///      test that passes cannot be relying on two roles being the same key.
abstract contract EscrowFixture is Test {
    uint128 internal constant ONE = 1e6; // 1 USDC
    uint64 internal constant START = 1_800_000_000;
    uint64 internal constant QUOTE_TTL = 60;
    uint64 internal constant DELAY = 7 days;

    bytes32 internal constant QUOTE_TYPEHASH = keccak256(
        "Quote(uint64 campaignId,address buyer,uint32 qty,uint128 maxHedgeCost,uint64 expiry,uint256 nonce)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant INSTRUMENT = keccak256("GEMI-TEXAS-ARKANSAS-SPREAD-13.5-YES");

    TestUSDC internal usdc;
    WinzEscrow internal escrow;

    address internal owner = makeAddr("owner");
    address internal relayer = makeAddr("relayer");
    address internal treasury = makeAddr("treasury");
    address internal oracle;
    uint256 internal oracleKey;

    address internal joe = makeAddr("joe");
    address internal ana = makeAddr("ana");
    address internal maya = makeAddr("maya");
    address internal liam = makeAddr("liam");
    address internal zoe = makeAddr("zoe");
    address internal stranger = makeAddr("stranger");

    uint64 internal salesClose;
    uint256 internal nextNonce = 1;

    function setUp() public virtual {
        vm.warp(START);
        (oracle, oracleKey) = makeAddrAndKey("oracle");
        usdc = new TestUSDC();
        escrow = new WinzEscrow(address(usdc), relayer, oracle, treasury, owner);
        usdc.mint(treasury, 1_000_000 * ONE);
        vm.prank(treasury);
        usdc.approve(address(escrow), type(uint256).max);
        salesClose = START + 1 days;
    }

    // ----------------------------------------------------------------------------------------------
    // Campaigns
    // ----------------------------------------------------------------------------------------------

    function _params(uint128 unitPrice, uint16 refundBps)
        internal
        view
        returns (IWinzEscrow.CampaignParams memory)
    {
        return IWinzEscrow.CampaignParams({
            instrument: INSTRUMENT, salesClose: salesClose, unitPrice: unitPrice, refundBps: refundBps
        });
    }

    function _create(address merchant, uint128 unitPrice, uint16 refundBps, uint128 budget)
        internal
        returns (uint64 id)
    {
        IWinzEscrow.CampaignParams memory params = _params(unitPrice, refundBps);
        vm.prank(relayer);
        id = escrow.createCampaignFor(merchant, params, budget);
    }

    /// @dev Joe's pizza: 20 USDC, 100 % back, 1 000 USDC of hedge budget.
    function _createJoe() internal returns (uint64 id) {
        id = _create(joe, 20 * ONE, 10_000, 1_000 * ONE);
    }

    // ----------------------------------------------------------------------------------------------
    // Quotes
    // ----------------------------------------------------------------------------------------------

    function _quote(uint64 id, address buyer, uint32 qty, uint128 maxHedgeCost)
        internal
        returns (IWinzEscrow.Quote memory)
    {
        return IWinzEscrow.Quote({
            campaignId: id,
            buyer: buyer,
            qty: qty,
            maxHedgeCost: maxHedgeCost,
            expiry: uint64(block.timestamp) + QUOTE_TTL,
            nonce: nextNonce++
        });
    }

    /// @dev EIP-712 digest computed here from the spec, not read from the contract, so the tests pin
    ///      the encoding the TypeScript signer has to reproduce.
    function _digestFor(IWinzEscrow.Quote memory q, address verifyingContract, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("WinzEscrow"), keccak256("1"), chainId, verifyingContract)
        );
        bytes32 structHash = keccak256(
            abi.encode(QUOTE_TYPEHASH, q.campaignId, q.buyer, q.qty, q.maxHedgeCost, q.expiry, q.nonce)
        );
        return keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
    }

    function _digest(IWinzEscrow.Quote memory q) internal view returns (bytes32) {
        return _digestFor(q, address(escrow), block.chainid);
    }

    function _signDigest(bytes32 digest, uint256 key) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sign(IWinzEscrow.Quote memory q) internal view returns (bytes memory) {
        return _signDigest(_digest(q), oracleKey);
    }

    // ----------------------------------------------------------------------------------------------
    // Actions
    // ----------------------------------------------------------------------------------------------

    function _buyFor(uint64 id, address buyer, uint32 qty, uint128 maxHedgeCost)
        internal
        returns (uint256 ticketId)
    {
        IWinzEscrow.Quote memory q = _quote(id, buyer, qty, maxHedgeCost);
        bytes memory sig = _sign(q);
        vm.prank(relayer);
        ticketId = escrow.buyFor(q, sig);
    }

    function _charge(uint256 ticketId, uint128 amount) internal {
        uint256[] memory ids = new uint256[](1);
        uint128[] memory amounts = new uint128[](1);
        ids[0] = ticketId;
        amounts[0] = amount;
        vm.prank(oracle);
        escrow.chargeHedge(ids, amounts);
    }

    function _settle(uint64 id, IWinzEscrow.Outcome outcome) internal {
        vm.prank(oracle);
        escrow.settle(id, outcome);
    }

    /// @dev Warps to `salesClose` of the campaign if it is still ahead, then settles.
    function _closeAndSettle(uint64 id, IWinzEscrow.Outcome outcome) internal {
        uint64 close = escrow.getCampaign(id).salesClose;
        if (block.timestamp < close) vm.warp(close);
        _settle(id, outcome);
    }

    function _ids(uint256 a) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = a;
    }

    function _ids(uint256 a, uint256 b) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
    }

    function _ids(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](3);
        ids[0] = a;
        ids[1] = b;
        ids[2] = c;
    }

    function _amounts(uint128 a) internal pure returns (uint128[] memory amounts) {
        amounts = new uint128[](1);
        amounts[0] = a;
    }

    function _amounts(uint128 a, uint128 b) internal pure returns (uint128[] memory amounts) {
        amounts = new uint128[](2);
        amounts[0] = a;
        amounts[1] = b;
    }

    function _amounts(uint128 a, uint128 b, uint128 c) internal pure returns (uint128[] memory amounts) {
        amounts = new uint128[](3);
        amounts[0] = a;
        amounts[1] = b;
        amounts[2] = c;
    }

    // ----------------------------------------------------------------------------------------------
    // Solvency (EC-2)
    // ----------------------------------------------------------------------------------------------

    /// @dev What the escrow owes: unpaid refunds plus unspent budget that was not handed back.
    function _obligations() internal view returns (uint256 total) {
        uint64 count = escrow.campaignCount();
        for (uint64 id = 1; id <= count; ++id) {
            IWinzEscrow.Campaign memory c = escrow.getCampaign(id);
            total += c.lockedRefunds;
            if (!c.released) total += c.hedgeBudget - c.hedgeSpent;
        }
    }

    /// @dev Nothing in these tests sends tokens straight to the escrow, so the invariant is an equality.
    function _assertSolvent() internal view {
        assertEq(
            IERC20(address(usdc)).balanceOf(address(escrow)), _obligations(), "escrow balance != obligations"
        );
    }
}
