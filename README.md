# solidity-rounding-lib

**Directional rounding for Solidity.** Full-precision `mulDiv` where the rounding
direction is an argument, not an accident.

![Solidity](https://img.shields.io/badge/Solidity-%5E0.8.20-363636?logo=solidity&logoColor=white)
![Tests](https://img.shields.io/badge/tests-98%20passing-16A34A)
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
npm test          # 98 passing
npm run coverage
npm run lint
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
