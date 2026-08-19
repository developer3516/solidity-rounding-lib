# solidity-rounding-lib

**Directional rounding for Solidity.** Full-precision `mulDiv` where the rounding
direction is an argument, not an accident.

![Solidity](https://img.shields.io/badge/Solidity-%5E0.8.20-363636?logo=solidity&logoColor=white)
![Tests](https://img.shields.io/badge/tests-222%20passing-16A34A)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## The problem

Solidity's `/` always truncates toward zero. In a protocol holding other
people's money, "toward zero" is the right answer roughly half the time.

Every conversion between two units — assets to shares, principal to interest,
collateral to debt — drops a remainder. Which way that remainder falls decides
whether the dust accrues to the protocol or to the user. Get it backwards on a
withdrawal path and a deposit-then-withdraw round trip mints value out of
nothing; repeat it in a loop and the dust becomes a drain.

```solidity
// Which of these is correct? It depends entirely on which side of the trade
// you are on — and nothing in the syntax tells the reviewer that.
shares = assets * totalShares / totalAssets;
assets = shares * totalAssets / totalShares;
```

The bug is not that the arithmetic is hard. It is that the decision is
invisible: nothing at the call site records which way the author *intended* to
round, so a reviewer cannot tell a deliberate choice from a default.

## The approach

Make the direction a required argument.

```solidity
using Rounding for uint256;

// Depositing: shares round DOWN, so the vault never over-issues.
shares = Rounding.mulDiv(assets, totalShares, totalAssets, Rounding.Direction.Down);

// Withdrawing the same position: the opposite direction, stated explicitly.
assets = Rounding.mulDiv(shares, totalAssets, totalShares, Rounding.Direction.Up);
```

Now the intent is in the diff. A reviewer scanning for `Direction.Up` on a path
that pays users out has something concrete to check.

---

## Install

```bash
npm install solidity-rounding-lib
```

```solidity
import {Rounding} from "solidity-rounding-lib/contracts/Rounding.sol";
```

Or just vendor `contracts/Rounding.sol` — it is a single dependency-free file.

---

## API

```solidity
enum Direction { Down, Up }

function opposite(Direction d) internal pure returns (Direction);

function div(uint256 a, uint256 b, Direction d) internal pure returns (uint256);
function divDown(uint256 a, uint256 b) internal pure returns (uint256);
function divUp(uint256 a, uint256 b) internal pure returns (uint256);

function mulDiv(uint256 x, uint256 y, uint256 denominator, Direction d) internal pure returns (uint256);
function mulDivDown(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256);
function mulDivUp(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256);
```

Errors: `DivisionByZero` · `MulDivOverflow`.

### `opposite` — the one that prevents the bug

A deposit and the withdrawal that reverses it must round in opposite
directions. Deriving the second from the first makes that structural instead of
leaving two hand-written call sites to agree:

```solidity
function _convert(uint256 amount, Rounding.Direction direction) internal view returns (uint256) {
    return Rounding.mulDiv(amount, totalShares, totalAssets, direction);
}

function _convertBack(uint256 shares, Rounding.Direction direction) internal view returns (uint256) {
    return Rounding.mulDiv(shares, totalAssets, totalShares, Rounding.opposite(direction));
}
```

---

## `SharesMath` — the library applied

`contracts/SharesMath.sol` is what `Rounding` exists for. A vault performs the
same multiply-divide in four places, and the correct direction differs in each:

| operation | user supplies | rounding | favours |
| :--- | :--- | :--- | :--- |
| `previewDeposit` | assets | **Down** | the vault |
| `previewMint` | shares | **Up** | the vault |
| `previewWithdraw` | assets | **Up** | the vault |
| `previewRedeem` | shares | **Down** | the vault |

Every row rounds toward the vault. That is not a coincidence — it is the only
assignment where no sequence of operations lets a user extract more than they
put in. Get one row backwards and it is not a rounding nuisance; it is a loop
that mints value.

```solidity
uint256 shares = SharesMath.previewDeposit(assets, totalAssets, totalShares, DECIMALS_OFFSET);
uint256 owed   = SharesMath.previewRedeem(shares, totalAssets, totalShares, DECIMALS_OFFSET);
```

Naming the four operations removes the choice. `toShares` and `toAssets` are
still there when you need an explicit `Direction`.

### Virtual assets and shares

Both conversions add 1 virtual asset and `10**offset` virtual shares. This
defends against the **inflation attack**: on an empty vault an attacker
deposits 1 wei, receives 1 share, then donates a large balance directly to the
vault. The share price explodes, the next depositor's shares truncate, and the
attacker redeems the difference.

The test suite runs that exact attack — 1 wei seed, a 10,000-token donation, a
10,000-token victim — and measures what the victim loses:

| decimals offset | victim receives | victim loses |
| ---: | ---: | ---: |
| 0 | **1 share** | **33.33%** |
| 3 | 1,999 shares | 0.02% |
| 6 | 1,999,999 shares | 0 |
| 9 | 1,999,999,999 shares | 0 |

Those numbers are asserted exactly, not as bounds — the point of the offset is
how sharply the loss falls off, so a regression should fail loudly.

The virtual amounts also keep both denominators non-zero, so an empty vault
needs no special case anywhere in the library.

---

## `FixedPoint` — WAD and RAY

`contracts/FixedPoint.sol` wraps the two scales almost every DeFi number lives
in: **WAD** (1e18) for prices, shares and percentages, **RAY** (1e27) for
interest indices that compound.

```solidity
uint256 fee     = FixedPoint.mulWadUp(amount, feeRate);      // charge up
uint256 payout  = FixedPoint.mulWadDown(amount, shareRate);  // pay down
uint256 index   = FixedPoint.mulRayDown(index, growth);
```

Mixing the two scales is a routine and expensive mistake — a RAY treated as a
WAD is off by a factor of a billion, and the code still compiles because both
are `uint256`. Naming the scale at the call site is the cheapest defence
available.

Every function delegates to `Rounding.mulDiv`, so the 512-bit intermediate
applies throughout: `mulWadDown(1e39, 1e39)` is fine even though `1e39 * 1e39`
overflows a `uint256` on its own.

### Why RAY exists

The suite demonstrates it rather than asserting it in prose. Take a rate of
`1 + 1e-27`:

```solidity
FixedPoint.mulWadDown(1e30, WAD)      // 1e30        — the rate isn't representable
FixedPoint.mulRayDown(1e30, RAY + 1)  // 1e30 + 1000 — it survives
```

At WAD scale that rate *is* exactly 1.0, so applying it does nothing. This is
why compounding indices are held in RAY: at WAD, a small per-second rate rounds
to a no-op and the index never moves.

`wadToRay` takes no direction — widening is exact — and reverts rather than
wrapping when a WAD is too large to represent, since silently wrapping would
corrupt an index instead of halting the call. `rayToWad` does take a direction:
nine digits are being discarded and something has to absorb them.

---

## `SignedRounding` — `int256`, where floor is not truncation

Signed rounding has a trap that unsigned rounding does not.

Solidity's `/` truncates **toward zero**. For positive operands that is the
same as flooring, so the distinction never surfaces and it is easy to assume
`a / b` floors. It does not:

```solidity
int256(-7) / 2                    // -3   ← truncation
SignedRounding.divDown(-7, 2)     // -4   ← floor
SignedRounding.divUp(-7, 2)       // -3   ← ceiling
```

On negatives, native division agrees with `Direction.Up`, not
`Direction.Down`. A codebase reaching for this library expecting `Down` to mean
"what `/` already did" will find every negative result shifted by one.

The definitions here are absolute rather than relative to zero:

| | |
| :--- | :--- |
| `Direction.Down` | toward −∞ (floor) |
| `Direction.Up` | toward +∞ (ceiling) |

Monotonic and sign-independent, which is what makes them safe for signed
accounting: flooring a loss and flooring a gain move the value the same way, so
a balance cannot drift upward merely by crossing zero. Truncation does drift —
it pulls negatives up and positives down.

### `int256.min`

The awkward value gets explicit handling rather than being hoped over.

`abs(type(int256).min)` is `2**255`, one past `int256.max`. The negation
`-x` overflows, so it is `unchecked` — not as a workaround, but because
wrapping produces the right answer: negating `-2**255` yields the same bit
pattern, and reading those bits as unsigned is exactly `2**255`.

That magnitude is representable, but only as a negative:

```solidity
SignedRounding.mulDivDown(2**254, 2, -1)  // int256.min
SignedRounding.mulDivDown(2**254, 2,  1)  // reverts MulDivOverflow
```

Both are pinned in the suite, along with all eight operand-sign combinations
and a differential fuzz against a `BigInt` reference that has to correct for
BigInt's own truncation — the same correction the library exists to make.

---

## `Interest` — accrual, and the asymmetry that keeps a market solvent

A lending market accrues interest twice over the same period: once onto what
borrowers owe, once onto what suppliers are owed. **The two must not round the
same way.**

| | rounds | because |
| :--- | :--- | :--- |
| `applyToDebt` | **Up** | the borrower owes at least this |
| `applyToClaim` | **Down** | the supplier is owed at most this |

Round both down and the market pays out interest it never collected. Round both
up and it promises suppliers more than borrowers were charged. Either way the
gap accrues every block and only surfaces when the last supplier tries to exit.

```solidity
uint256 factor = Interest.compound(ratePerSecond, block.timestamp - lastAccrual);

totalDebt   = Interest.applyToDebt(totalDebt, factor);
totalSupply = Interest.applyToClaim(totalSupply, factor);
```

The suite simulates exactly that — one borrower, one supplier, equal principals,
daily accrual for a year — and asserts the market ends able to pay.

### `advanceIndex` fixes its own direction

Unlike the pair above, this one takes no `Direction` argument at all. An index
that rounded up would grow on every touch, so a market poked in a loop would
charge more interest than one left alone — a bug that pays whoever calls
`accrue` repeatedly. A test advances an index ten times by a no-op factor and
asserts it has not moved.

### Compounding

`compound` uses the three-term binomial expansion — the same approximation Aave
uses, for the same reason: the exact power costs far more gas than the error is
worth.

```
1 + nx + n(n-1)/2 x² + n(n-1)(n-2)/6 x³
```

The omitted terms are all positive, so the result is always an
**underestimate**. That is the safe direction for a borrow index: it can never
charge more than true compounding would. The suite checks it against exact
BigInt compounding and finds zero basis points of error over a day.

Because the truncation grows with the period, `compound` **reverts** beyond 400
days rather than quietly drifting.

Rates are per-second in RAY, which is the concrete answer to why `FixedPoint`
carries RAY at all: 5% APR is about `1.0000000015` per second, and at WAD scale
that rate is exactly `1.0` — the index would never move.

---

## `Decimals` — the scale mismatch

USDC has 6 decimals, WETH has 18, WBTC has 8, and a handful of tokens have 0.
An amount is just a `uint256`; nothing in the type says which scale it is in.
Almost every protocol that touches more than one token has to reconcile them,
and it is one of the quietest sources of loss in DeFi.

The two directions are **not symmetric**, and treating them as if they were is
the bug:

| | | direction argument |
| :--- | :--- | :--- |
| `widen` (6 → 18) | multiplies — exact, no remainder | none, because there is no choice |
| `narrow` (18 → 6) | divides — twelve digits discarded | **required** |

Offering a direction on `widen` would imply a decision that does not exist.
Omitting it on `narrow` would make one silently.

```solidity
uint256 inWeth = Decimals.widen(usdcAmount, 6, 18);                        // exact
uint256 payout = Decimals.narrow(wethAmount, 18, 6, Rounding.Direction.Down); // your call
```

### The round trip is lossy, and the number is worse than people expect

```solidity
Decimals.narrow(1, 18, 6, Down);   // 0
// convert 1 wei of WETH to USDC precision and back -> 0
```

Not almost zero — **zero**. One wei is a billionth of the smallest
representable USDC amount. Code that normalises to a common scale to compare
and then converts back to pay out is destroying value on every call.

`roundTripLoss` exists so that can be checked *before* it happens:

```solidity
uint256 lost = Decimals.roundTripLoss(amount, 18, 6);
if (lost > DUST_THRESHOLD) revert PrecisionLoss(lost);
```

A test asserts `amount - afterRoundTrip == roundTripLoss(amount)` exactly, so
the prediction and the reality cannot drift apart.

`widen` **reverts** rather than quietly narrowing when the target scale is
smaller — a caller who reached for `widen` believes nothing is being lost, and
doing the lossy thing silently would betray precisely that belief. `pow10`
caps at 77, since `10**78` overflows a `uint256`.

---

## `Liquidation` — where the direction rule inverts

This is where the rest of the library meets. A liquidation crosses two token
scales (`Decimals`), applies a bonus in basis points (`Percentage`), and
divides twice at full precision (`Rounding`). Each is a place a unit can go the
wrong way, and the party who loses it is always the same: the borrower being
forcibly closed out, who is not in the room.

**So the rule inverts here.** Everywhere else in this library the protocol
rounds in its own favour, because the counterparty is a voluntary depositor.
Seizure rounds **down** — the liquidator gets at most what the bonus entitles
them to, and the dust stays with the borrower.

```solidity
uint256 seized = Liquidation.collateralToSeize(
    debtRepaid, 6, usdcPrice,     // repaying USDC
    18, wethPrice,                // seizing WETH
    500                           // 5% bonus
);
```

The inverse question — *how much must I repay to seize this collateral* —
rounds **up**, for the mirror-image reason: quote a liquidator too little and
the position ends up under-repaid, and the shortfall lands on the protocol. A
test asserts the round trip holds: repaying the quoted amount always buys at
least the collateral that was asked for.

### The arithmetic, and why it is two steps

```
seize = repaid × debtPrice × 10^collDec × (BPS + bonus)
        ───────────────────────────────────────────────
             collPrice × 10^debtDec × BPS
```

Written that way it overflows a `uint256` long before the division brings it
back, so it is two `mulDiv` calls. The intermediate is deliberately the *value
of the repayment at collateral scale* — largest multiplication first, lossy
division last. The other order truncates small repayments to zero:

| | |
| :--- | :--- |
| 1 USDC of debt, WETH at \$3,000 | `333333333333333` wei |
| divide-first implementation | `0` |

Both are pinned, along with a repayment of `10**52` where the naive product
genuinely does overflow and the 512-bit intermediate is the only reason it
works.

`bonusPortion` splits a seizure into principal and bonus by **subtraction**, so
`principal + bonus == seized` exactly — the same identity `Percentage.split`
protects for fees. `maxRepayable` rounds down, because a close factor that
rounds up is not a bound.

---

## The counterexample

`contracts/examples/` holds two vaults. `RoundingVault` is a minimal
ERC-4626-shaped vault built on `SharesMath`. `BrokenVault` extends it and
changes **one argument**:

```solidity
function previewRedeem(uint256 shares) public view override returns (uint256) {
    return SharesMath.toAssets(
        shares, totalAssets(), totalSupply(), decimalsOffset,
        Rounding.Direction.Up          // <-- should be Down
    );
}
```

It compiles. It passes any test that checks one deposit and one withdrawal. A
reviewer skimming it sees a `mulDiv` with an explicit direction — which is what
correct code looks like.

Here is what the suite measures on both vaults. Same deposit, same vault state;
the only variable is how many instalments the exit is split into:

| instalments | 1 | 2 | 5 | 10 | 25 | 200 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| `RoundingVault` | −1 | −1 | −3 | −3 | −3 | −3 |
| `BrokenVault` | 0 | **+1** | **+2** | **+3** | +3 | +3 |

The correct vault is never ahead, and splitting the exit buys nothing. The
broken one turns a break-even withdrawal into a profitable one as soon as the
exit is taken in pieces — each instalment collects the ceiling, and the
difference comes out of the other depositors' backing. A test asserts exactly
that: a passive holder's shares are worth less afterwards, having done nothing.

Splitting an exit is the sharp test rather than deposit-then-withdraw
round-tripping, where the deposit's floor and the redemption's ceiling cancel
out — which is why this class of bug survives casual testing.

**The honest bound:** the leak plateaus at +3 because this vault was seeded
with 7 wei of dust, and a ceiling cannot invent value — it can only hand over
what has accumulated. The bound is dust, not anything in the code, and a live
vault accrues dust on every yield event.

---

## `Percentage` — fees that add up

A fee is not one calculation, it is two: what the protocol takes, and what the
user is left with. The obvious way to write them is independently —

```solidity
fee = amount * feeBps / 10_000;
net = amount * (10_000 - feeBps) / 10_000;
```

— and that is wrong roughly half the time. Both truncate, so whenever the
division is inexact the two sum to `amount - 1` and a unit vanishes. Round both
up instead and they sum to `amount + 1`, which is worse: the contract now owes
more than it holds, and on a large enough batch it cannot settle.

`split` computes the fee and derives the net by **subtraction**:

```solidity
(uint256 fee, uint256 net) = Percentage.split(amount, feeBps);
// fee + net == amount, exactly, for every input
```

No rounding argument to get wrong, and nothing to reason about. The suite
asserts the identity across every amount and rate it can think of, including
`type(uint256).max`, and asserts the naive form failing the same inputs:

| | `split(1, 3333)` | 200-item batch |
| :--- | :--- | :--- |
| naive independent | `0 + 0 = 0` — a unit gone | short by one per inexact item |
| `Percentage.split` | `1 + 0 = 1` | sums exactly |

The direction still matters for the part that *is* a choice. `feeOn` rounds
**up**, toward the protocol — a fee that rounds down is a protocol donating
dust on every transaction it processes. And because `bps <= BPS` guarantees the
fee never exceeds the amount, the subtraction in `netOf` cannot underflow;
there is a test pinning that too.

`applyBps` deliberately *does* accept a rate above 100% — liquidation bonuses
and penalty multipliers legitimately exceed `BPS`, and rejecting them would
push callers back to hand-rolled `mulDiv`. `feeOn` and `subBps` do not, since
there a rate over 100% is a bug.

Also here: `addBps`, `subBps` (where the direction describes the *deduction*,
so `Up` leaves less), and `bpsOf`.

---

## Gas

`npm run bench` measures this library against OpenZeppelin `Math` and Solmate
`FixedPointMathLib` on a local node.

**Product fits in 256 bits** — the fast path everything shares:

| | gas |
| :--- | ---: |
| Solmate `mulDivUp` | 117 |
| Solmate `mulDivDown` | 134 |
| naive `x * y / d` | 206 |
| **`Rounding.mulDivDown`** | **215** |
| OZ `Math.mulDiv` | 260 |
| **`Rounding.mulDivUp`** | **310** |
| OZ `Math.mulDiv` (Ceil) | 683 |

**Product exceeds 256 bits** — where the intermediate precision earns its cost:

| | gas |
| :--- | ---: |
| **`Rounding.mulDivDown`** | **519** |
| OZ `Math.mulDiv` | 554 |
| **`Rounding.mulDivUp`** | **614** |
| OZ `Math.mulDiv` (Ceil) | 977 |
| Solmate `mulDivDown` | **reverts** |
| naive `x * y / d` | **reverts** |

Two things worth reading off that.

**Solmate is cheaper because it does less.** It has no 512-bit intermediate, so
it carries no overflow branch — and it reverts on any input where `x * y`
overflows, however small the quotient would have been. That is a reasonable
trade when your operands are bounded; it is not the same function. Both tables
are here rather than only the flattering one.

**Against OpenZeppelin, which implements the same algorithm**, this comes out
slightly ahead on both paths. The suite asserts the ratio stays under 1.25×, so
a regression fails rather than quietly costing users gas.

### How it is measured

Every benchmark function is non-view and writes to storage, so each call
produces a receipt with a real `gasUsed`. A `view` function measured through
`estimateGas` would fold in the transaction's intrinsic cost and calldata
pricing, neither of which says anything about the arithmetic.

A `noop` with an identical signature and an identical storage write is
subtracted from each result, and the slot is pre-warmed — otherwise the first
zero-to-non-zero `SSTORE` costs 20,000 gas and swamps everything being
compared. The figures are deltas, so treat them as relative, not absolute.

---

## Implementation notes

**512-bit intermediate precision.** `mulDiv` computes `x * y / denominator`
without the multiplication overflowing first, using the 512-bit division from
Remco Bloemen's *Math by Fabrications* — the same algorithm behind Uniswap V3's
`FullMath` and OpenZeppelin's `Math`. It reverts with `MulDivOverflow` only when
the *true quotient* exceeds 256 bits, not merely when the product does:

```solidity
Rounding.mulDivDown(2**255, 2, 4);      // 2**254 — the product overflows, the quotient does not
Rounding.mulDivDown(type(uint256).max, type(uint256).max, type(uint256).max);  // max
```

**`divUp` avoids the overflowing idiom.** The common `(a + b - 1) / b` reverts
when `a` is near `type(uint256).max` — precisely where balances are largest —
and returns `1` for `a == 0`, minting a share for a zero deposit. This library
uses `a == 0 ? 0 : (a - 1) / b + 1`, which does neither.

**A zero denominator is always `DivisionByZero`.** The overflow guard
`denominator <= prod1` is also satisfied by a zero denominator, so the zero
check runs first. Otherwise a divide-by-zero would masquerade as an overflow
and send the next person debugging in the wrong direction.

**`mulDivUp` handles the unrepresentable ceiling.** There is exactly one class
of input where the floor fits in 256 bits but the ceiling does not — for
instance `(M-1)² = (M-2)·M + 1`, whose floor is `type(uint256).max` with a
remainder of 1. That case reverts rather than silently wrapping to zero, and it
has a dedicated test.

---

## Tests

```bash
npm install
npm test          # 222 passing
npm run coverage
npm run lint
npm run bench     # gas vs OpenZeppelin and Solmate
```

The suite is not only unit tests. It runs a **differential fuzz** against a
JavaScript `BigInt` reference implementation — arbitrary precision, and a
genuinely independent oracle rather than a reimplementation of the same
algorithm that would share its bugs. 320 pseudo-random triples are drawn from a
seeded PRNG (so a failure reproduces from the seed) across bit widths that
exercise the 256-bit fast path, the 512-bit path, and the small values where
dust matters most. Overflow cases are asserted to revert, not skipped.

Everything is exercised through a deployed harness contract, so the tests hit
real compiled bytecode — including the revert paths.

There is also a round-trip invariant: converting assets to shares and back must
never return more than went in. That is the property the whole library exists
to protect.

---

## License

MIT
