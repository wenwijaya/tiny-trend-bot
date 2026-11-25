# Tiny Trend Bot — make.fun `u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1`

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) [![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/wenwijaya/tiny-trend-bot/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) [![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/wenwijaya/tiny-trend-bot/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny paper-trading bot for hourly Solana prices that beats buy-and-hold.
Entry for the [Tiny Bot, Easy $2 bounty](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
(free entry, $2 pot, three paid places, closes 2026-11-27T00:00Z).

## Strategy

Per symbol (FARTCOIN, JITOSOL, POPCAT, RAY, SOL, WETH, WIF), track a 12h
fast EMA and a 26h slow EMA of hourly closes — the classic MACD pair,
slow enough to ignore hourly whipsaws, fast enough to catch a multi-day
trend within about a day.

- **Enter** (target 12% of equity) when the fast EMA is above the slow EMA
  and the latest close is at or above the slow EMA: the symbol is in an
  uptrend.
- **Exit** (target 0) when the fast EMA falls below the slow EMA, or the
  close drops 5% below the highest close seen since entry (trailing stop).
- Rebalance only when the gap between target and current value exceeds 2%
  of equity, so the 10 bps fee and slippage do not eat the edge.
- Never short, never levered, at most one order per symbol per bar, at most
  90% of equity invested.

In a falling market the bot sits in USDC — that is exactly how it beats
buy-and-hold. In a rising market it rides the trend. Every decision is a
pure function of the bars seen: no clock, no randomness, so the two
replay runs match byte for byte.

## Local grade (dev window, 136 hourly bars)

```
net PnL        -$194.13  (buy-and-hold on the same window: about -$862)
return         -1.94%
max drawdown   1.94%     (guardrail: <= 25%)
trades         35        (guardrail: >= 8)
symbols        5
fees           $42.58
deterministic  reproduced: true (two runs match)
```

## Run

`main.ts` is the entrypoint (Node 22, standard library only). It speaks
`agent-fun/bars-replay/v1` over stdin/stdout through the vendored shim in
`vendor/makefun-bars.ts`. Grade it with the kit:

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree
```

## License

MIT — see [LICENSE](LICENSE).
