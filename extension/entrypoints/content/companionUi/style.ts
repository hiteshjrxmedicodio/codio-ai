/** Card contents (header, rows, buttons), shared by the pointer card and the docked card. */
export const CARD_BODY_STYLE = `
  .head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: #03045a; color: #fff; font-weight: 600; font-size: 12px; }
  .body { padding: 9px 11px 11px; display: grid; gap: 8px; }
  .muted { color: #6b6f80; font-size: 12px; }
  .group { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #6b6f80; }
  .row { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: start; padding: 6px 8px; border: 1px solid #e3e6ef; border-radius: 8px; background: #fff; }
  .code { font: 700 13px/1.3 ui-monospace, Menlo, monospace; color: #03045a; }
  .desc { font-size: 12.5px; } .conf { font-size: 11px; color: #6b6f80; font-variant-numeric: tabular-nums; }
  .why { grid-column: 1 / -1; font-size: 11.5px; color: #6b6f80; }
  .copy { grid-column: 3; grid-row: 2; justify-self: end; border: 1px solid #e3e6ef; background: #f4f6fb; border-radius: 6px; font: 600 11px system-ui, sans-serif; padding: 2px 7px; cursor: pointer; color: #1f2230; }
  .actions { display: flex; gap: 8px; }
  .btn { border: 0; border-radius: 999px; padding: 6px 14px; font: 600 12.5px system-ui, sans-serif; cursor: pointer; }
  .btn.primary { background: #00309f; color: #fff; } .btn.ghost { background: transparent; color: #1f2230; border: 1px solid #e3e6ef; }
  .field { border: 1px solid #e3e6ef; border-radius: 8px; background: #fff; padding: 6px 8px; }
  .field b { display: block; font-size: 12.5px; color: #1f2230; } .field span { font-size: 12px; color: #454a5c; }
  .q { justify-self: end; max-width: 85%; background: #eef0f6; border-radius: 12px; padding: 5px 9px; font-size: 12.5px; }
  .sug { display: flex; align-items: center; gap: 4px; border: 1px solid #e3e6ef; border-radius: 8px; background: #fff; padding: 2px 4px 2px 0; }
  .sug-main { flex: 1; min-width: 0; text-align: left; cursor: pointer; background: none; border: 0; padding: 4px 8px; font: inherit; color: inherit; }
  .sug-main b { display: block; font-size: 12.5px; color: #1f2230; } .sug-main span { font-size: 12px; color: #454a5c; }
  .sug.gone { padding: 6px 8px; border-style: dashed; color: #6b6f80; font-size: 12px; background: transparent; }
  .votes { display: inline-flex; gap: 2px; flex: none; }
  .vote { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 6px; background: none; color: #6b6f80; cursor: pointer; padding: 0; }
  .vote svg { width: 15px; height: 15px; } .vote:hover { background: #eef0f6; color: #1f2230; } .vote.on { color: #00309f; }
  .vote:focus-visible { outline: 2px solid #5b8cff; outline-offset: 1px; }
  /* Quotes are capped at three lines so the thumbs and the fix stay in view; the full quote is the tooltip. */
  .quote { border-left: 2px solid #e3e6ef; padding-left: 7px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  /* ICD list: the phrase, its code beside it. */
  .dx { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; cursor: pointer; border: 1px solid #e3e6ef; border-radius: 8px; background: #fff; padding: 6px 8px; font: inherit; color: inherit; }
  .dx:hover { border-color: #b9c3ea; background: #fbfaff; }
  .dx .ph { flex: 1; min-width: 0; display: grid; gap: 1px; font-size: 12.5px; color: #1f2230; }
  .dx .ph small { font-size: 11.5px; color: #6b6f80; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dx.off { background: #f7f8fb; } .dx.off .ph > span { color: #6b6f80; }
  .sum { display: flex; gap: 12px; font-size: 12px; color: #6b6f80; } .sum b { color: #03045a; font-size: 14px; margin-right: 3px; }
  .chip { flex: none; font: 700 12px/1 ui-monospace, Menlo, monospace; color: #03045a; background: #eef1fb; border-radius: 6px; padding: 4px 6px; }
  .chip.none { font: 600 11px/1 system-ui, sans-serif; color: #6b6f80; background: #eef0f6; }
  /* Diagnosis detail: three titled sections, each section's content under its title. */
  .flow { display: grid; gap: 12px; }
  .flow .sh { font-size: 12px; font-weight: 600; color: #1f2230; }
  .flow .sb { display: grid; gap: 5px; margin-top: 5px; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; font-size: 12px; }
  .kv dt { color: #6b6f80; } .kv dd { margin: 0; color: #1f2230; }
  .gap { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11.5px; }
  .gap .gl { color: #6b6f80; margin-right: 2px; } .gap .tag { background: #f8eadf; color: #9a3412; border-radius: 5px; padding: 2px 6px; }
  .all summary { cursor: pointer; font-size: 11.5px; color: #00309f; margin-top: 4px; list-style: none; } .all summary::-webkit-details-marker { display: none; }
  .all[open] summary { margin-bottom: 6px; }
  /* Prediction trail: the engine's steps as a short timeline. */
  .trail { list-style: none; margin: 0; padding: 0 0 0 12px; border-left: 2px solid #dfe4f6; display: grid; gap: 7px; }
  .trail li { position: relative; display: grid; gap: 2px; font-size: 12px; }
  .trail li::before { content: ""; position: absolute; left: -17px; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: #5b8cff; }
  .trail li.end::before { background: #15803d; } .trail li.stop::before { background: #c2410c; }
  .trail .what { color: #1f2230; font-weight: 600; } .trail .sub { color: #454a5c; } .trail b { font-family: ui-monospace, Menlo, monospace; color: #03045a; }
  .rate { display: flex; align-items: center; gap: 6px; }
  .fix { background: #f4f6fb; border-radius: 8px; padding: 8px 9px; font-size: 12.5px; }
  .fix ul { margin: 6px 0 0; padding-left: 16px; color: #454a5c; } .fix li { margin: 2px 0; }
  .spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #e3e6ef; border-top-color: #00309f; animation: spin .8s linear infinite; flex: none; }
  /* Coding in progress: a three-part stage bar, then one live row per diagnosis, all running at once. */
  .prog { display: grid; gap: 3px; }
  .bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-bottom: 5px; }
  .seg { height: 4px; border-radius: 4px; background: #e3e6ef; overflow: hidden; position: relative; }
  .seg.done { background: #00309f; }
  .seg.now { background: #c9d3f0; } .seg.now::after { content: ""; position: absolute; inset: 0; width: 40%; border-radius: 4px; background: #00309f; animation: slide 1.3s ease-in-out infinite; }
  .pt { font-size: 13px; font-weight: 600; color: #1f2230; } .ps { font-size: 11.5px; color: #6b6f80; font-variant-numeric: tabular-nums; }
  .live { display: grid; gap: 5px; }
  .lr { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid #e3e6ef; border-radius: 8px; background: #fff; font-size: 12.5px; }
  .lr .ph { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1f2230; }
  .lr .ind { width: 9px; height: 9px; border-radius: 50%; flex: none; border: 2px solid #c9d3f0; border-top-color: #00309f; animation: spin .8s linear infinite; }
  .lr.done .ind { animation: none; border: 0; background: #15803d; }
  .lr.read .ind { animation: none; border-color: #00309f; }
  .lr.skipped, .lr.failed { background: #f7f8fb; } .lr.skipped .ph, .lr.failed .ph { color: #6b6f80; }
  .lr.skipped .ind { animation: none; border-color: #d5d9e6; } .lr.failed .ind { animation: none; border: 0; background: #c2410c; }
  .lr.ghost .ind { animation: none; border-color: #e3e6ef; }
  .sk { flex: none; font: 600 10.5px/1 system-ui, sans-serif; color: #5d6aa8; padding: 4px 7px; border-radius: 6px;
    background: linear-gradient(90deg, #eef1fb 25%, #dfe5f8 50%, #eef1fb 75%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
  .sk.wide { flex: 1; height: 10px; padding: 0; }
  .tag { flex: none; font: 600 10.5px/1 system-ui, sans-serif; color: #6b6f80; background: #eef0f6; border-radius: 6px; padding: 4px 7px; }
  .tag.bad { color: #9a3412; background: #f8eadf; }
  .pop { animation: pop .35s cubic-bezier(.2,.9,.3,1.4); }
  @keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  @keyframes slide { from { left: -40%; } to { left: 100%; } }
  @keyframes pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .sk, .seg.now::after, .lr .ind, .pop { animation: none; } }
`;

/** Styles for the Codio AI companion: one element that is a pill or a card. */
export const STYLE = `
  :host { all: initial; position: fixed; left: 0; top: 0; z-index: 2147483646; }
  :host(.moving) { transition: transform .3s cubic-bezier(.2,.8,.2,1); }
  .shell { position: absolute; left: 0; top: 0; transform: translate(16px, 18px); box-sizing: border-box;
    background: #03045a; color: #fff; border-radius: 999px; border: 1px solid transparent; overflow: hidden;
    box-shadow: 0 4px 14px rgba(3, 4, 90, .25); pointer-events: none; font: 13px/1.45 system-ui, -apple-system, sans-serif;
    transition: transform .3s cubic-bezier(.2,.8,.2,1), width .3s cubic-bezier(.2,.8,.2,1), height .3s cubic-bezier(.2,.8,.2,1), border-radius .3s, background-color .3s,
      color .3s, box-shadow .3s, opacity .2s; }
  .shell.hidden { opacity: 0; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px 4px 6px; white-space: nowrap;
    font: 600 11.5px/1.2 system-ui, -apple-system, sans-serif; transition: opacity .15s; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #5b8cff; flex: none; }
  .mic { display: none; width: 13px; height: 13px; flex: none; }
  .listening { background: #c2410c; animation: pulse 1.1s ease-in-out infinite; }
  .listening .dot { display: none; } .listening .mic { display: block; }
  .working .dot { background: transparent; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; width: 6px; height: 6px; animation: spin .8s linear infinite; }
  .panel { display: none; width: 347px; box-sizing: border-box; overflow-y: auto; opacity: 0; transition: opacity .2s .1s; }
  .shell.card { transform: translate(0, 0); background: #ffffff; color: #1f2230; border-radius: 14px; border-color: #e3e6ef; pointer-events: auto;
    box-shadow: 0 12px 34px rgba(3, 4, 90, .18); }
  .shell.card .pill { position: absolute; opacity: 0; pointer-events: none; }
  .shell.card .panel, .shell.measuring .panel { display: block; }
  .shell.card .panel { opacity: 1; }
  .shell .chev { display: none; }
  .shell.measuring { width: 347px !important; height: auto !important; visibility: hidden; }

  ${CARD_BODY_STYLE}
  @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(194, 65, 12, .45); } 50% { box-shadow: 0 0 0 7px rgba(194, 65, 12, 0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .shell, :host(.moving) { transition: none; } .listening, .working .dot, .spin { animation: none; } }
`;
