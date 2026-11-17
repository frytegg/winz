// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IWinzEscrow} from "./interfaces/IWinzEscrow.sol";

/// @title WinzEscrow
/// @notice Escrow for "refunded if the team wins" promotions, settled in USDC on Arc.
/// @dev What the contract holds, per campaign, is exactly `lockedRefunds` (the refundable part of the
///      tickets not paid out yet) plus `hedgeBudget - hedgeSpent` while the budget has not been
///      released. Every function keeps that equality (solvency invariant, EC-2); the treasury is only
///      ever pulled from (`createCampaignFor`, `topUpBudgetFor`, `buyFor`, `payMerchant`), so an empty
///      treasury can block a sale or a merchant payment but never a settlement or a refund.
///
///      Trust model: `relayer` and `oracle` are Winz keys and `usdc` is a trusted token. The owner can
///      rotate the three roles, nothing else. Neither role can change `refundBps`, charge a ticket
///      above its signed guarantee, or redirect a refund away from the ticket's buyer.
contract WinzEscrow is IWinzEscrow, Ownable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------------------------------------
    // Constants and storage
    // ----------------------------------------------------------------------------------------------

    /// @inheritdoc IWinzEscrow
    uint64 public constant override EMERGENCY_DELAY = 7 days;

    /// @notice EIP-712 type hash of {IWinzEscrow.Quote}.
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(uint64 campaignId,address buyer,uint32 qty,uint128 maxHedgeCost,uint64 expiry,uint256 nonce)"
    );

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant USDC_DECIMALS = 6;

    /// @inheritdoc IWinzEscrow
    address public immutable override usdc;

    /// @inheritdoc IWinzEscrow
    address public override relayer;

    /// @inheritdoc IWinzEscrow
    address public override oracle;

    /// @inheritdoc IWinzEscrow
    address public override treasury;

    /// @inheritdoc IWinzEscrow
    uint64 public override campaignCount;

    /// @inheritdoc IWinzEscrow
    uint256 public override ticketCount;

    /// @inheritdoc IWinzEscrow
    mapping(uint256 nonce => bool used) public override nonceUsed;

    mapping(uint64 id => Campaign) private _campaigns;
    mapping(uint256 ticketId => Ticket) private _tickets;

    // ----------------------------------------------------------------------------------------------
    // Modifiers
    // ----------------------------------------------------------------------------------------------

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert Unauthorized();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert Unauthorized();
        _;
    }

    // ----------------------------------------------------------------------------------------------
    // Construction and roles
    // ----------------------------------------------------------------------------------------------

    /// @param usdc_ ERC-20 interface of USDC. Must answer `decimals() == 6`, else InvalidTokenDecimals.
    /// @param relayer_ Key that creates campaigns, buys, pauses and closes on behalf of merchants.
    /// @param oracle_ Key that signs quotes, charges hedge costs and settles.
    /// @param treasury_ Address funds are pulled from; it must have approved this contract.
    /// @param owner_ Address allowed to rotate the three roles.
    constructor(address usdc_, address relayer_, address oracle_, address treasury_, address owner_)
        Ownable(owner_)
        EIP712("WinzEscrow", "1")
    {
        // A low-level call so that an address without code, a token without `decimals()` and a token
        // with other decimals all fail with the same error.
        (bool ok, bytes memory data) = usdc_.staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));
        if (!ok || data.length != 32 || abi.decode(data, (uint256)) != USDC_DECIMALS) {
            revert InvalidTokenDecimals();
        }
        usdc = usdc_;
        _setRoles(relayer_, oracle_, treasury_);
    }

    /// @notice Rotates the relayer, oracle and treasury addresses.
    /// @dev Owner only. Reverts with InvalidParams if one of them is zero or if the treasury is this
    ///      contract. Quotes signed by the previous oracle stop being accepted immediately.
    /// @param relayer_ New relayer.
    /// @param oracle_ New oracle.
    /// @param treasury_ New treasury; it must have approved this contract.
    function setRoles(address relayer_, address oracle_, address treasury_) external onlyOwner {
        _setRoles(relayer_, oracle_, treasury_);
    }

    // ----------------------------------------------------------------------------------------------
    // Relayer
    // ----------------------------------------------------------------------------------------------

    /// @inheritdoc IWinzEscrow
    function createCampaignFor(address merchant, CampaignParams calldata params, uint128 budget)
        external
        override
        onlyRelayer
        nonReentrant
        returns (uint64 id)
    {
        if (
            merchant == address(0) || params.unitPrice == 0 || params.refundBps == 0
                || params.refundBps > BPS_DENOMINATOR || params.salesClose <= block.timestamp
        ) revert InvalidParams();

        id = ++campaignCount;
        Campaign storage c = _campaigns[id];
        c.merchant = merchant;
        c.instrument = params.instrument;
        c.salesClose = params.salesClose;
        c.unitPrice = params.unitPrice;
        c.refundBps = params.refundBps;
        c.hedgeBudget = budget;

        emit CampaignCreated(
            id, merchant, params.instrument, params.refundBps, params.salesClose, params.unitPrice, budget
        );

        _pull(treasury, address(this), budget);
    }

    /// @inheritdoc IWinzEscrow
    /// @dev Reverts with InvalidParams when `amount` is zero.
    function topUpBudgetFor(uint64 id, uint128 amount) external override onlyRelayer nonReentrant {
        Campaign storage c = _existingCampaign(id);
        if (_isSettled(c.status)) revert AlreadySettled();
        if (c.released) revert AlreadyReleased();
        if (amount == 0) revert InvalidParams();

        c.hedgeBudget += amount;

        emit BudgetToppedUp(id, amount);

        _pull(treasury, address(this), amount);
    }

    /// @inheritdoc IWinzEscrow
    function buyFor(Quote calldata quote, bytes calldata signature)
        external
        override
        onlyRelayer
        nonReentrant
        returns (uint256 ticketId)
    {
        ticketId = _purchase(quote, signature, treasury);
    }

    /// @inheritdoc IWinzEscrow
    /// @dev Only real transitions are accepted: pausing a paused campaign or resuming a live one
    ///      reverts with InvalidParams.
    function setPaused(uint64 id, bool paused) external override onlyRelayer {
        Campaign storage c = _existingCampaign(id);
        Status status = c.status;
        if (_isSettled(status)) revert AlreadySettled();
        if (block.timestamp >= c.salesClose) revert SalesAreClosed();
        if (paused == (status == Status.Paused)) revert InvalidParams();

        c.status = paused ? Status.Paused : Status.Live;

        emit CampaignPaused(id, paused);
    }

    /// @inheritdoc IWinzEscrow
    function closeSales(uint64 id) external override onlyRelayer {
        Campaign storage c = _existingCampaign(id);
        // A settled campaign is always past its `salesClose`, so this check covers it too.
        if (block.timestamp >= c.salesClose) revert SalesAreClosed();

        // Safe cast: the timestamp is below `salesClose`, itself a uint64.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp);
        c.salesClose = nowTs;

        emit SalesClosedEarly(id, nowTs);
    }

    // ----------------------------------------------------------------------------------------------
    // Customer (optional direct path)
    // ----------------------------------------------------------------------------------------------

    /// @inheritdoc IWinzEscrow
    function buy(Quote calldata quote, bytes calldata signature)
        external
        override
        nonReentrant
        returns (uint256 ticketId)
    {
        if (msg.sender != quote.buyer) revert QuoteMismatch();
        ticketId = _purchase(quote, signature, msg.sender);
    }

    // ----------------------------------------------------------------------------------------------
    // Oracle
    // ----------------------------------------------------------------------------------------------

    /// @inheritdoc IWinzEscrow
    function chargeHedge(uint256[] calldata ticketIds, uint128[] calldata amounts)
        external
        override
        onlyOracle
        nonReentrant
    {
        uint256 count = ticketIds.length;
        if (count != amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i; i < count; ++i) {
            uint256 ticketId = ticketIds[i];
            uint128 amount = amounts[i];

            Ticket storage t = _existingTicket(ticketId);
            uint64 id = t.campaignId;
            Campaign storage c = _campaigns[id];
            if (_isSettled(c.status)) revert AlreadySettled();
            if (c.released) revert AlreadyReleased();
            if (t.hedgeCharged) revert HedgeAlreadyCharged();
            uint128 guarantee = t.maxHedgeCost;
            if (amount > guarantee) revert HedgeAboveGuarantee();

            t.hedgeCharged = true;
            c.hedgeReserved -= guarantee;
            c.hedgeSpent += amount;
            total += amount;

            emit HedgeCharged(ticketId, id, amount);
        }

        if (total != 0) IERC20(usdc).safeTransfer(treasury, total);
    }

    /// @inheritdoc IWinzEscrow
    function settle(uint64 id, Outcome outcome) external override onlyOracle {
        Campaign storage c = _existingCampaign(id);
        if (_isSettled(c.status)) revert AlreadySettled();
        uint256 salesClose = c.salesClose;
        if (block.timestamp < salesClose) revert SalesStillOpen();
        // `released` can only be set before settlement by `emergencyReleaseBudget`, which needs the
        // emergency window; the window never closes again, so the flag is redundant with the time
        // check and is kept as a second lock.
        if (c.released || block.timestamp >= salesClose + EMERGENCY_DELAY) revert EmergencyActive();
        if (c.hedgeReserved != 0) revert HedgeNotFinalized();

        uint128 due;
        if (outcome == Outcome.Yes) {
            c.status = Status.SettledYes;
            due = c.lockedRefunds;
        } else if (outcome == Outcome.Void) {
            c.status = Status.Void;
            due = c.hedgeSpent;
        } else {
            c.status = Status.SettledNo;
        }
        c.merchantDue = due;

        emit CampaignSettled(id, outcome, due);
    }

    // ----------------------------------------------------------------------------------------------
    // Anyone
    // ----------------------------------------------------------------------------------------------

    /// @inheritdoc IWinzEscrow
    function payMerchant(uint64 id) external override nonReentrant {
        Campaign storage c = _existingCampaign(id);
        if (!_isSettled(c.status)) revert NotSettled();
        uint128 due = c.merchantDue;
        if (due == 0) revert NothingDue();

        c.merchantDue = 0;

        emit MerchantPaid(id, due);

        IERC20(usdc).safeTransferFrom(treasury, c.merchant, due);
    }

    /// @inheritdoc IWinzEscrow
    /// @dev Unknown ticket ids are skipped like tickets of another campaign. Reverts with NotSettled
    ///      before settlement and WrongOutcome when the campaign settled NO or VOID.
    function refundBatch(uint64 id, uint256[] calldata ticketIds) external override nonReentrant {
        Campaign storage c = _existingCampaign(id);
        Status status = c.status;
        if (!_isSettled(status)) revert NotSettled();
        if (status != Status.SettledYes) revert WrongOutcome();

        IERC20 token = IERC20(usdc);
        uint256 count = ticketIds.length;
        for (uint256 i; i < count; ++i) {
            uint256 ticketId = ticketIds[i];
            Ticket storage t = _tickets[ticketId];
            // An unknown ticket has campaignId 0, which is never a campaign id.
            if (t.campaignId != id || t.paidOut) continue;

            address buyer = t.buyer;
            uint128 amount = t.refundable;

            // Effects first, undone if the transfer fails: the ticket then stays owed.
            t.paidOut = true;
            c.lockedRefunds -= amount;

            if (token.trySafeTransfer(buyer, amount)) {
                emit TicketRefunded(ticketId, id, buyer, amount);
            } else {
                t.paidOut = false;
                c.lockedRefunds += amount;
                emit RefundFailed(ticketId, id);
            }
        }
    }

    /// @inheritdoc IWinzEscrow
    function release(uint64 id) external override nonReentrant {
        Campaign storage c = _existingCampaign(id);
        Status status = c.status;
        if (!_isSettled(status)) revert NotSettled();
        if (c.released) revert AlreadyReleased();

        uint128 amount = c.hedgeBudget - c.hedgeSpent;
        if (status != Status.SettledYes) {
            // NO or VOID: nobody is refunded, the escrow belongs to the merchant.
            amount += c.lockedRefunds;
            c.lockedRefunds = 0;
        }
        c.released = true;

        emit CampaignReleased(id, amount);

        _send(c.merchant, amount);
    }

    /// @inheritdoc IWinzEscrow
    /// @dev Pays `refundable`, the only part of the price this contract holds, never `paid`.
    function emergencyClaim(uint256 ticketId) external override nonReentrant {
        Ticket storage t = _existingTicket(ticketId);
        uint64 id = t.campaignId;
        Campaign storage c = _campaigns[id];
        if (!_emergencyActive(c)) revert EmergencyNotActive();
        if (t.paidOut) revert AlreadyPaidOut();

        address buyer = t.buyer;
        uint128 amount = t.refundable;
        t.paidOut = true;
        c.lockedRefunds -= amount;

        emit TicketRefunded(ticketId, id, buyer, amount);

        _send(buyer, amount);
    }

    /// @inheritdoc IWinzEscrow
    /// @dev Drops every open reservation: afterwards `chargeHedge` and `settle` revert for this
    ///      campaign.
    function emergencyReleaseBudget(uint64 id) external override nonReentrant {
        Campaign storage c = _existingCampaign(id);
        if (!_emergencyActive(c)) revert EmergencyNotActive();
        if (c.released) revert AlreadyReleased();

        uint128 amount = c.hedgeBudget - c.hedgeSpent;
        c.released = true;
        c.hedgeReserved = 0;

        emit CampaignReleased(id, amount);

        _send(c.merchant, amount);
    }

    // ----------------------------------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------------------------------

    /// @inheritdoc IWinzEscrow
    /// @dev Reverts with CampaignNotFound for an unknown id.
    function getCampaign(uint64 id) external view override returns (Campaign memory) {
        return _existingCampaign(id);
    }

    /// @inheritdoc IWinzEscrow
    /// @dev Reverts with TicketNotFound for an unknown id.
    function getTicket(uint256 ticketId) external view override returns (Ticket memory) {
        return _existingTicket(ticketId);
    }

    /// @inheritdoc IWinzEscrow
    /// @dev Reverts with CampaignNotFound for an unknown id. The formula is not adjusted once the
    ///      budget has been released: read `released` alongside it.
    function availableBudget(uint64 id) external view override returns (uint128) {
        return _available(_existingCampaign(id));
    }

    /// @inheritdoc IWinzEscrow
    function quoteDigest(Quote calldata quote) external view override returns (bytes32) {
        return _quoteDigest(quote);
    }

    // ----------------------------------------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------------------------------------

    /// @dev Shared body of `buyFor` and `buy`. `payer` is the treasury or the buyer.
    function _purchase(Quote calldata quote, bytes calldata signature, address payer)
        private
        returns (uint256 ticketId)
    {
        Campaign storage c = _existingCampaign(quote.campaignId);
        _checkQuote(quote, signature);
        _checkSaleOpen(c, quote.maxHedgeCost);

        uint256 price = uint256(quote.qty) * c.unitPrice;
        if (price > type(uint128).max) revert InvalidParams();
        // Safe cast: checked on the line above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 paid = uint128(price);
        // Rounded down: the merchant keeps the dust. Safe cast: `refundBps <= 10_000`, so the
        // result is at most `price`.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 refundable = uint128(price * c.refundBps / BPS_DENOMINATOR);

        nonceUsed[quote.nonce] = true;
        c.hedgeReserved += quote.maxHedgeCost;
        c.lockedRefunds += refundable;

        ticketId = ++ticketCount;
        _tickets[ticketId] = Ticket({
            campaignId: quote.campaignId,
            buyer: quote.buyer,
            paid: paid,
            refundable: refundable,
            maxHedgeCost: quote.maxHedgeCost,
            hedgeCharged: false,
            paidOut: false
        });

        emit TicketPurchased(
            ticketId, quote.campaignId, quote.buyer, quote.qty, paid, refundable, quote.maxHedgeCost
        );

        _pull(payer, address(this), refundable);
        _pull(payer, c.merchant, paid - refundable);
    }

    /// @dev Quote-level checks: shape, expiry, nonce, then the oracle's signature.
    function _checkQuote(Quote calldata quote, bytes calldata signature) private view {
        if (quote.qty == 0 || quote.buyer == address(0)) revert InvalidParams();
        if (block.timestamp > quote.expiry) revert QuoteExpired();
        if (nonceUsed[quote.nonce]) revert QuoteNonceUsed();
        (address signer, ECDSA.RecoverError recoverError,) =
            ECDSA.tryRecoverCalldata(_quoteDigest(quote), signature);
        if (recoverError != ECDSA.RecoverError.NoError || signer != oracle) revert QuoteBadSignature();
    }

    /// @dev Campaign-level checks of a sale: Live, before `salesClose`, guarantee within the budget.
    function _checkSaleOpen(Campaign storage c, uint128 maxHedgeCost) private view {
        Status status = c.status;
        if (status == Status.Paused) revert SalesArePaused();
        if (status != Status.Live) revert AlreadySettled();
        if (block.timestamp >= c.salesClose) revert SalesAreClosed();
        if (maxHedgeCost > _available(c)) revert BudgetExceeded();
    }

    function _setRoles(address relayer_, address oracle_, address treasury_) private {
        if (
            relayer_ == address(0) || oracle_ == address(0) || treasury_ == address(0)
                || treasury_ == address(this)
        ) revert InvalidParams();
        relayer = relayer_;
        oracle = oracle_;
        treasury = treasury_;
        emit RolesUpdated(relayer_, oracle_, treasury_);
    }

    /// @dev `transferFrom(from, to, amount)`; nothing is called for a zero amount.
    function _pull(address from, address to, uint256 amount) private {
        if (amount != 0) IERC20(usdc).safeTransferFrom(from, to, amount);
    }

    /// @dev `transfer(to, amount)` from the escrow; nothing is called for a zero amount.
    function _send(address to, uint256 amount) private {
        if (amount != 0) IERC20(usdc).safeTransfer(to, amount);
    }

    function _quoteDigest(Quote calldata quote) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH,
                    quote.campaignId,
                    quote.buyer,
                    quote.qty,
                    quote.maxHedgeCost,
                    quote.expiry,
                    quote.nonce
                )
            )
        );
    }

    function _existingCampaign(uint64 id) private view returns (Campaign storage c) {
        c = _campaigns[id];
        if (c.merchant == address(0)) revert CampaignNotFound();
    }

    function _existingTicket(uint256 ticketId) private view returns (Ticket storage t) {
        t = _tickets[ticketId];
        if (t.buyer == address(0)) revert TicketNotFound();
    }

    function _available(Campaign storage c) private view returns (uint128) {
        return c.hedgeBudget - c.hedgeSpent - c.hedgeReserved;
    }

    /// @dev True from `salesClose + EMERGENCY_DELAY` on, for a campaign that was never settled.
    function _emergencyActive(Campaign storage c) private view returns (bool) {
        return !_isSettled(c.status) && block.timestamp >= uint256(c.salesClose) + EMERGENCY_DELAY;
    }

    function _isSettled(Status status) private pure returns (bool) {
        return status != Status.Live && status != Status.Paused;
    }
}
