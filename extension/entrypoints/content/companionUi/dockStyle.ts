import { CARD_BODY_STYLE } from "./style";

/**
 * Styles for the top-right card stack. Every card shows its header bar; only the open card shows
 * its body, capped in height and scrolling inside, so the stack stays compact.
 */
export const DOCK_STYLE = `
  :host { all: initial; position: fixed; top: 12px; right: 16px; z-index: 2147483646; }
  .stack { box-sizing: border-box; width: 340px; max-height: calc(100vh - 24px); overflow-y: auto; display: flex; flex-direction: column; gap: 8px;
    font: 13px/1.45 system-ui, -apple-system, sans-serif; color: #24211c; scrollbar-width: thin; }
  .stack:empty { display: none; }
  .card { flex: none; background: #fffdf8; border: 1px solid #e6ddcc; border-radius: 14px; overflow: hidden;
    box-shadow: 0 10px 28px rgba(3, 4, 90, .16); transition: opacity .22s ease, transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .2s; }
  .card.entering { opacity: 0; transform: translateX(24px); }
  .card > .head { cursor: pointer; user-select: none; }
  .card > .head:focus-visible { outline: 2px solid #5b8cff; outline-offset: -2px; }
  /* The open card's body: capped so one card never takes the whole corner. */
  .card > :not(.head) { max-height: min(46vh, 440px); overflow-y: auto; }
  .card.collapsed { box-shadow: 0 4px 14px rgba(3, 4, 90, .14); }
  .card.collapsed > :not(.head) { display: none; }
  .card.updated > .head .dot { animation: ping 1.4s ease-out; }
  ${CARD_BODY_STYLE}
  /* After the shared card styles, so the chevron sits next to × at the right of the header. */
  .chev { display: inline-flex; margin-left: auto; width: 16px; height: 16px; align-items: center; justify-content: center;
    color: #c9ccf2; transition: transform .2s; }
  .chev svg { width: 12px; height: 12px; }
  .chev + .x { margin-left: 6px; }
  .head:hover .chev { color: #fff; }
  .card.collapsed .chev { transform: rotate(-90deg); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #5b8cff; flex: none; }
  @keyframes ping { 0% { box-shadow: 0 0 0 0 rgba(91, 140, 255, .8); } 100% { box-shadow: 0 0 0 9px rgba(91, 140, 255, 0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .card, .chev { transition: none; } .card.updated > .head .dot { animation: none; } }
`;
