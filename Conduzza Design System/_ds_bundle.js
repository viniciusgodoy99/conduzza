/* @ds-bundle: {"format":4,"namespace":"ConduzzaDesignSystem_cea3ac","components":[{"name":"ChatBubble","sourcePath":"components/chat/ChatBubble.jsx"},{"name":"Composer","sourcePath":"components/chat/Composer.jsx"},{"name":"ConversationItem","sourcePath":"components/chat/ConversationItem.jsx"},{"name":"KanbanCard","sourcePath":"components/chat/KanbanCard.jsx"},{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"StatCard","sourcePath":"components/core/StatCard.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"BarChart","sourcePath":"components/data/BarChart.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"DonutChart","sourcePath":"components/data/DonutChart.jsx"},{"name":"EmptyState","sourcePath":"components/data/EmptyState.jsx"},{"name":"ProgressBar","sourcePath":"components/data/ProgressBar.jsx"},{"name":"Banner","sourcePath":"components/feedback/Banner.jsx"},{"name":"Modal","sourcePath":"components/feedback/Modal.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Dropdown","sourcePath":"components/forms/Dropdown.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"SearchField","sourcePath":"components/forms/SearchField.jsx"},{"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"},{"name":"PageHeader","sourcePath":"components/navigation/PageHeader.jsx"},{"name":"SidebarNav","sourcePath":"components/navigation/SidebarNav.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"TopBar","sourcePath":"components/navigation/TopBar.jsx"},{"name":"AppointmentCard","sourcePath":"components/scheduling/AppointmentCard.jsx"}],"sourceHashes":{"components/chat/ChatBubble.jsx":"7f36c97d42ce","components/chat/Composer.jsx":"cfc1ebea2d6e","components/chat/ConversationItem.jsx":"17d5280d0ceb","components/chat/KanbanCard.jsx":"694cd19134a6","components/core/Avatar.jsx":"269b3cc7e512","components/core/Badge.jsx":"573230a3b730","components/core/Button.jsx":"eb1ffbb23cf4","components/core/Card.jsx":"ee0f1b98e3f3","components/core/Icon.jsx":"17accf2c318f","components/core/IconButton.jsx":"1e2f8619916b","components/core/StatCard.jsx":"2b6132dac3ca","components/core/Tag.jsx":"f55e780f433b","components/data/BarChart.jsx":"9c94363ddcec","components/data/DataTable.jsx":"b9b8216ffac8","components/data/DonutChart.jsx":"845ccf0ffd78","components/data/EmptyState.jsx":"b6fb5b9a06af","components/data/ProgressBar.jsx":"df112fe5006a","components/feedback/Banner.jsx":"0de977900b70","components/feedback/Modal.jsx":"921f8d8e7b2b","components/feedback/Toast.jsx":"01e300b818f1","components/feedback/Tooltip.jsx":"a558eda7d47e","components/forms/Checkbox.jsx":"78a87697698e","components/forms/Dropdown.jsx":"bddea1ed8a5c","components/forms/Input.jsx":"1082cda5134e","components/forms/SearchField.jsx":"d0f03a5f40ca","components/forms/SegmentedControl.jsx":"02cd5363b6b2","components/forms/Select.jsx":"3833d375caef","components/forms/Switch.jsx":"1e01f8deabd8","components/forms/Textarea.jsx":"ba009be0b44a","components/navigation/PageHeader.jsx":"b894424994c4","components/navigation/SidebarNav.jsx":"b69e5ce56618","components/navigation/Tabs.jsx":"772e3cfdfafe","components/navigation/TopBar.jsx":"89ba406370bf","components/scheduling/AppointmentCard.jsx":"d32197d6e5d3","ui_kits/conduzza-chat/app.jsx":"aaee2913a065","ui_kits/conduzza-chat/data.jsx":"74c6b665fade","ui_kits/conduzza-chat/screens-admin.jsx":"99f39d69accd","ui_kits/conduzza-chat/screens-agenda.jsx":"980801291614","ui_kits/conduzza-chat/screens-inteligencia.jsx":"09332e816d8c","ui_kits/conduzza-chat/screens-operacao.jsx":"313cd4f695c2"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ConduzzaDesignSystem_cea3ac = window.ConduzzaDesignSystem_cea3ac || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  xs: 24,
  sm: 30,
  md: 36,
  lg: 44,
  xl: 56
};
const PALETTE = ['#b2e54f', '#7fb320', '#4785b5', '#d9962a', '#2f9e5b', '#8b9a92'];
function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Contact avatar. Falls back to initials on a deterministic brand-palette tint. */
function Avatar({
  name = '',
  src,
  size = 'md',
  status,
  square = false,
  style,
  ...rest
}) {
  const d = SIZES[size] || SIZES.md;
  const seed = String(name).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const tint = PALETTE[seed % PALETTE.length];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: 'relative',
      display: 'inline-flex',
      flex: '0 0 auto',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: d,
      height: d,
      borderRadius: square ? 'var(--radius-md)' : '50%',
      background: src ? `center/cover url(${src})` : `color-mix(in oklab, ${tint} 26%, var(--cz-paper-050))`,
      color: 'var(--cz-ink-900)',
      display: 'grid',
      placeItems: 'center',
      overflow: 'hidden',
      fontSize: Math.round(d * 0.36),
      fontWeight: 'var(--fw-bold)',
      letterSpacing: '-0.02em',
      boxShadow: 'inset 0 0 0 1px var(--border-hairline)'
    }
  }, src ? '' : initials(name)), status && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: Math.max(8, d * 0.28),
      height: Math.max(8, d * 0.28),
      borderRadius: '50%',
      border: '2px solid var(--surface)',
      background: status === 'online' ? 'var(--cz-success-500)' : status === 'busy' ? 'var(--cz-warning-500)' : 'var(--cz-ink-300)'
    }
  }));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** The universal surface: white, 16px radius, hairline border, low soft shadow. */
function Card({
  children,
  padding = 16,
  tone = 'default',
  interactive = false,
  header,
  actions,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const tones = {
    default: {
      bg: 'var(--surface)',
      bd: 'var(--border-hairline)'
    },
    sunken: {
      bg: 'var(--surface-sunken)',
      bd: 'transparent'
    },
    accent: {
      bg: 'var(--cz-lime-050)',
      bd: 'rgba(127,179,32,.22)'
    },
    inverse: {
      bg: 'var(--cz-ink-900)',
      bd: 'rgba(251,252,232,.10)'
    }
  };
  const t = tones[tone] || tones.default;
  return /*#__PURE__*/React.createElement("section", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    className: tone === 'inverse' ? 'cz-dark' : undefined,
    style: {
      background: t.bg,
      border: `1px solid ${t.bd}`,
      borderRadius: 'var(--radius-card)',
      boxShadow: interactive && hover ? 'var(--shadow-md)' : tone === 'sunken' ? 'none' : 'var(--shadow-sm)',
      transform: interactive && hover ? 'translateY(-1px)' : 'none',
      transition: 'box-shadow var(--dur-base) var(--ease-standard),transform var(--dur-base) var(--ease-standard)',
      cursor: interactive ? 'pointer' : undefined,
      overflow: 'hidden',
      ...style
    }
  }, rest), (header || actions) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: `14px ${padding}px`,
      borderBottom: '1px solid var(--border-hairline)'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 'var(--text-h3)',
      fontWeight: 'var(--fw-bold)',
      letterSpacing: 'var(--ls-h3)'
    }
  }, header), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding
    }
  }, children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const BASE = 'https://unpkg.com/lucide-static@0.544.0/icons/';
const CACHE = new Map(); // name -> svg markup string
const INFLIGHT = new Map();
function load(name) {
  if (CACHE.has(name)) return null;
  if (!INFLIGHT.has(name)) {
    INFLIGHT.set(name, fetch(BASE + name + '.svg').then(r => r.ok ? r.text() : '').then(t => {
      CACHE.set(name, t);
      return t;
    }).catch(() => {
      CACHE.set(name, '');
      return '';
    }));
  }
  return INFLIGHT.get(name);
}

/**
 * Lucide glyph, inlined as real SVG so it inherits currentColor and survives
 * rasterisation (html-to-image, PNG/PDF export). Fetched once per name, cached.
 */
function Icon({
  name = 'circle',
  size = 18,
  color = 'currentColor',
  style,
  className,
  title,
  ...rest
}) {
  const [, tick] = React.useReducer(n => n + 1, 0);
  const markup = CACHE.get(name);
  React.useEffect(() => {
    if (CACHE.has(name)) return;
    let alive = true;
    const p = load(name);
    if (p) p.then(() => {
      if (alive) tick();
    });
    return () => {
      alive = false;
    };
  }, [name]);
  const base = {
    display: 'inline-flex',
    flex: '0 0 auto',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    color,
    lineHeight: 0,
    ...style
  };
  if (!markup) return /*#__PURE__*/React.createElement("span", _extends({
    role: "presentation",
    className: className,
    style: base
  }, rest));
  const sized = markup.replace(/width="24"/, `width="${size}"`).replace(/height="24"/, `height="${size}"`);
  return /*#__PURE__*/React.createElement("span", _extends({
    role: title ? 'img' : 'presentation',
    "aria-label": title,
    className: className,
    style: base,
    dangerouslySetInnerHTML: {
      __html: sized
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/chat/ChatBubble.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** A single WhatsApp message. Inbound is white, outbound is lime, AI is inky. */
function ChatBubble({
  from = 'in',
  author,
  time,
  status,
  children,
  attachment,
  note = false,
  style,
  ...rest
}) {
  const out = from !== 'in';
  const skins = {
    in: {
      bg: 'var(--surface)',
      fg: 'var(--text-body)',
      bd: 'var(--border-hairline)'
    },
    out: {
      bg: 'var(--cz-lime-100)',
      fg: 'var(--cz-ink-900)',
      bd: 'transparent'
    },
    ai: {
      bg: 'var(--cz-ink-900)',
      fg: 'var(--cz-cream-050)',
      bd: 'transparent'
    },
    note: {
      bg: 'var(--cz-warning-050)',
      fg: 'var(--cz-warning-700)',
      bd: 'rgba(217,150,42,.2)'
    }
  };
  const s = skins[note ? 'note' : from] || skins.in;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: out ? 'flex-end' : 'flex-start',
      gap: 3,
      ...style
    }
  }, rest), author && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--text-faint)',
      padding: '0 4px',
      fontWeight: 'var(--fw-semibold)'
    }
  }, author), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '68%',
      minWidth: 96,
      padding: '9px 12px 7px',
      background: s.bg,
      color: s.fg,
      border: `1px solid ${s.bd}`,
      borderRadius: 'var(--radius-bubble)',
      borderBottomRightRadius: out ? 6 : undefined,
      borderBottomLeftRadius: out ? undefined : 6,
      boxShadow: 'var(--shadow-xs)',
      fontSize: 13.5,
      lineHeight: 1.5
    }
  }, attachment && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
      padding: '8px 10px',
      borderRadius: 'var(--radius-sm)',
      background: out ? 'rgba(5,24,19,.06)' : 'var(--surface-sunken)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: attachment.icon || 'paperclip',
    size: 16
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      fontWeight: 'var(--fw-medium)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, attachment.name)), /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: 'pre-wrap'
    }
  }, children), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 4,
      marginTop: 3,
      opacity: 0.55
    }
  }, time && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 10
    }
  }, time), out && status && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: status === 'read' ? 'check-check' : status === 'sent' ? 'check' : 'clock',
    size: 12,
    color: status === 'read' ? 'var(--cz-lime-700)' : undefined
  }))));
}
Object.assign(__ds_scope, { ChatBubble });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/ChatBubble.jsx", error: String((e && e.message) || e) }); }

// components/chat/ConversationItem.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** One row of the Atendimento inbox list. */
function ConversationItem({
  name,
  preview,
  time,
  unread = 0,
  active = false,
  tags = [],
  channel = 'whatsapp',
  assignee,
  aiHandled = false,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      gap: 10,
      width: '100%',
      padding: '11px 14px',
      border: 'none',
      borderLeft: `2px solid ${active ? 'var(--cz-lime-400)' : 'transparent'}`,
      borderBottom: '1px solid var(--border-hairline)',
      textAlign: 'left',
      cursor: 'pointer',
      background: active ? 'var(--cz-lime-050)' : hover ? 'var(--cz-paper-050)' : 'var(--surface)',
      transition: 'background-color var(--dur-fast) var(--ease-standard)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    name: name,
    size: "md"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 14,
      height: 14,
      borderRadius: '50%',
      display: 'grid',
      placeItems: 'center',
      background: channel === 'whatsapp' ? 'var(--cz-whatsapp)' : 'var(--cz-meta)',
      border: '2px solid var(--surface)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: channel === 'whatsapp' ? 'message-circle' : 'at-sign',
    size: 7,
    color: "#fff"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 13.5,
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-strong)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 10.5,
      color: 'var(--text-faint)',
      flex: '0 0 auto'
    }
  }, time)), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, aiHandled && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "sparkles",
    size: 12,
    color: "var(--cz-lime-700)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 12.5,
      color: 'var(--text-muted)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, preview), unread > 0 && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      flex: '0 0 auto',
      minWidth: 18,
      height: 18,
      padding: '0 5px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--cz-lime-400)',
      color: 'var(--cz-ink-900)',
      fontSize: 10.5,
      fontWeight: 700,
      display: 'grid',
      placeItems: 'center'
    }
  }, unread)), (tags.length > 0 || assignee) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      flexWrap: 'wrap',
      marginTop: 1
    }
  }, tags.map(t => /*#__PURE__*/React.createElement("span", {
    key: t.label,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      height: 17,
      padding: '0 6px',
      borderRadius: 4,
      background: 'var(--surface-sunken)',
      fontSize: 10.5,
      color: 'var(--text-muted)',
      fontWeight: 'var(--fw-medium)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 5,
      borderRadius: 1.5,
      background: t.color
    }
  }), t.label)), assignee && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--text-faint)',
      marginLeft: 'auto'
    }
  }, assignee))));
}
Object.assign(__ds_scope, { ConversationItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/ConversationItem.jsx", error: String((e && e.message) || e) }); }

// components/chat/KanbanCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Draggable card in the Leads board. Compact by design — four facts, no more. */
function KanbanCard({
  name,
  phone,
  meta,
  tags = [],
  owner,
  value,
  waiting,
  urgent = false,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("article", _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 11,
      background: 'var(--surface)',
      borderRadius: 'var(--radius-md)',
      border: `1px solid ${urgent ? 'rgba(212,85,61,.35)' : 'var(--border-hairline)'}`,
      boxShadow: hover ? 'var(--shadow-md)' : 'var(--shadow-xs)',
      transform: hover ? 'translateY(-1px)' : 'none',
      cursor: 'grab',
      transition: 'box-shadow var(--dur-fast) var(--ease-standard),transform var(--dur-fast) var(--ease-standard)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    name: name,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-strong)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, name), phone && /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, phone)), urgent && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "flame",
    size: 14,
    color: "var(--cz-danger-500)"
  })), meta && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)',
      lineHeight: 1.45
    }
  }, meta), tags.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4,
      flexWrap: 'wrap'
    }
  }, tags.map(t => /*#__PURE__*/React.createElement("span", {
    key: t.label,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      height: 18,
      padding: '0 6px',
      borderRadius: 4,
      background: 'var(--surface-sunken)',
      fontSize: 10.5,
      color: 'var(--text-muted)',
      fontWeight: 'var(--fw-medium)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 5,
      borderRadius: 1.5,
      background: t.color
    }
  }), t.label))), (owner || value || waiting) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      paddingTop: 7,
      borderTop: '1px solid var(--border-hairline)'
    }
  }, owner && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, owner), waiting && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "clock",
    size: 11
  }), waiting), value && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      marginLeft: 'auto',
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--cz-lime-700)'
    }
  }, value)));
}
Object.assign(__ds_scope, { KanbanCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/KanbanCard.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  neutral: {
    bg: 'var(--cz-ink-050)',
    fg: 'var(--cz-ink-700)',
    dot: 'var(--cz-ink-400)'
  },
  lime: {
    bg: 'var(--cz-lime-050)',
    fg: 'var(--cz-lime-800)',
    dot: 'var(--cz-lime-500)'
  },
  success: {
    bg: 'var(--cz-success-050)',
    fg: 'var(--cz-success-700)',
    dot: 'var(--cz-success-500)'
  },
  warning: {
    bg: 'var(--cz-warning-050)',
    fg: 'var(--cz-warning-700)',
    dot: 'var(--cz-warning-500)'
  },
  danger: {
    bg: 'var(--cz-danger-050)',
    fg: 'var(--cz-danger-700)',
    dot: 'var(--cz-danger-500)'
  },
  info: {
    bg: 'var(--cz-info-050)',
    fg: 'var(--cz-info-700)',
    dot: 'var(--cz-info-500)'
  },
  inverse: {
    bg: 'var(--cz-ink-900)',
    fg: 'var(--cz-cream-050)',
    dot: 'var(--cz-lime-400)'
  }
};

/** Status pill. Carries state, never an action. */
function Badge({
  tone = 'neutral',
  children,
  dot = false,
  icon,
  size = 'md',
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.neutral;
  const sm = size === 'sm';
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: sm ? 4 : 6,
      height: sm ? 20 : 24,
      padding: `0 ${sm ? 7 : 9}px`,
      borderRadius: 'var(--radius-pill)',
      background: t.bg,
      color: t.fg,
      fontSize: sm ? 11 : 12,
      fontWeight: 'var(--fw-semibold)',
      letterSpacing: '-0.005em',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: t.dot,
      flex: '0 0 auto'
    }
  }), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: sm ? 11 : 13
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    h: 'var(--control-h-sm)',
    px: 10,
    fs: 13,
    gap: 6,
    icon: 14
  },
  md: {
    h: 'var(--control-h-md)',
    px: 14,
    fs: 14,
    gap: 7,
    icon: 16
  },
  lg: {
    h: 'var(--control-h-lg)',
    px: 20,
    fs: 15,
    gap: 8,
    icon: 18
  }
};
const VARIANTS = {
  primary: {
    bg: 'var(--cz-lime-400)',
    fg: 'var(--cz-ink-900)',
    bd: 'transparent',
    hover: 'var(--cz-lime-500)',
    shadow: 'var(--shadow-xs)'
  },
  solid: {
    bg: 'var(--cz-ink-900)',
    fg: 'var(--cz-cream-050)',
    bd: 'transparent',
    hover: 'var(--cz-ink-800)',
    shadow: 'var(--shadow-xs)'
  },
  secondary: {
    bg: 'var(--surface)',
    fg: 'var(--text-strong)',
    bd: 'var(--border-subtle)',
    hover: 'var(--cz-paper-100)',
    shadow: 'var(--shadow-xs)'
  },
  ghost: {
    bg: 'transparent',
    fg: 'var(--text-body)',
    bd: 'transparent',
    hover: 'var(--cz-ink-050)',
    shadow: 'none'
  },
  soft: {
    bg: 'var(--cz-lime-050)',
    fg: 'var(--cz-lime-800)',
    bd: 'transparent',
    hover: 'var(--cz-lime-100)',
    shadow: 'none'
  },
  danger: {
    bg: 'var(--cz-danger-050)',
    fg: 'var(--cz-danger-700)',
    bd: 'transparent',
    hover: '#fbe0da',
    shadow: 'none'
  }
};

/** The one button. Lime = the single committing action on a screen. */
function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  block = false,
  disabled = false,
  loading = false,
  active = false,
  children,
  style,
  onClick,
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const off = disabled || loading;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: off,
    onClick: off ? undefined : onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      display: block ? 'flex' : 'inline-flex',
      width: block ? '100%' : undefined,
      alignItems: 'center',
      justifyContent: 'center',
      gap: s.gap,
      height: s.h,
      padding: `0 ${s.px}px`,
      borderRadius: 'var(--radius-control)',
      border: `1px solid ${v.bd}`,
      background: hover && !off || active ? v.hover : v.bg,
      color: v.fg,
      fontFamily: 'var(--font-sans)',
      fontSize: s.fs,
      fontWeight: 'var(--fw-semibold)',
      letterSpacing: '-0.005em',
      boxShadow: v.shadow,
      cursor: off ? 'not-allowed' : 'pointer',
      opacity: off ? 0.45 : 1,
      transform: press && !off ? 'scale(.975)' : 'none',
      transition: 'var(--transition-control)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), loading ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "loader-circle",
    size: s.icon,
    style: {
      animation: 'cz-spin 900ms linear infinite'
    }
  }) : icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: s.icon
  }) : null, children, iconRight ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: s.icon
  }) : null, /*#__PURE__*/React.createElement("style", null, '@keyframes cz-spin{to{transform:rotate(360deg)}}'));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: 28,
  md: 34,
  lg: 40
};
const GLYPH = {
  sm: 15,
  md: 17,
  lg: 19
};
const VARIANTS = {
  primary: {
    bg: 'var(--cz-lime-400)',
    fg: 'var(--cz-ink-900)',
    bd: 'transparent',
    hover: 'var(--cz-lime-500)'
  },
  solid: {
    bg: 'var(--cz-ink-900)',
    fg: 'var(--cz-cream-050)',
    bd: 'transparent',
    hover: 'var(--cz-ink-800)'
  },
  secondary: {
    bg: 'var(--surface)',
    fg: 'var(--text-body)',
    bd: 'var(--border-subtle)',
    hover: 'var(--cz-paper-100)'
  },
  ghost: {
    bg: 'transparent',
    fg: 'var(--text-muted)',
    bd: 'transparent',
    hover: 'var(--cz-ink-050)'
  },
  soft: {
    bg: 'var(--cz-lime-050)',
    fg: 'var(--cz-lime-800)',
    bd: 'transparent',
    hover: 'var(--cz-lime-100)'
  },
  danger: {
    bg: 'transparent',
    fg: 'var(--cz-danger-500)',
    bd: 'transparent',
    hover: 'var(--cz-danger-050)'
  }
};

/** Icon-only button. Same visual family as Button, square footprint. */
function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  round = false,
  active = false,
  disabled = false,
  badge,
  style,
  onClick,
  ...rest
}) {
  const d = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.ghost;
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: disabled ? undefined : onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: d,
      height: d,
      flex: '0 0 auto',
      borderRadius: round ? 'var(--radius-pill)' : 'var(--radius-sm)',
      border: `1px solid ${v.bd}`,
      background: hover && !disabled || active ? v.hover : v.bg,
      color: active ? 'var(--text-strong)' : v.fg,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transform: press && !disabled ? 'scale(.94)' : 'none',
      transition: 'var(--transition-control)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: GLYPH[size] || 17
  }), badge != null && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      position: 'absolute',
      top: -4,
      right: -4,
      minWidth: 16,
      height: 16,
      padding: '0 4px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--cz-lime-400)',
      color: 'var(--cz-ink-900)',
      fontSize: 10,
      fontWeight: 700,
      display: 'grid',
      placeItems: 'center',
      border: '2px solid var(--surface)'
    }
  }, badge));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/chat/Composer.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Message composer: quick replies row, textarea, attachment tools, send. */
function Composer({
  value = '',
  onChange,
  onSend,
  placeholder = 'Escreva uma mensagem…',
  quickReplies = [],
  aiSuggestion,
  disabled = false,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      flex: '0 0 auto',
      padding: 12,
      background: 'var(--surface)',
      borderTop: '1px solid var(--border-hairline)',
      display: 'flex',
      flexDirection: 'column',
      gap: 9,
      ...style
    }
  }, rest), aiSuggestion && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      padding: '8px 11px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--cz-lime-050)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "sparkles",
    size: 14,
    color: "var(--cz-lime-700)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 12.5,
      color: 'var(--cz-lime-800)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, aiSuggestion), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => onChange && onChange(aiSuggestion),
    style: {
      border: 'none',
      background: 'transparent',
      color: 'var(--cz-lime-800)',
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, "Usar")), quickReplies.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      display: 'flex',
      gap: 6,
      overflowX: 'auto',
      paddingBottom: 2
    }
  }, quickReplies.map(q => /*#__PURE__*/React.createElement("button", {
    key: q,
    type: "button",
    onClick: () => onChange && onChange(q),
    style: {
      flex: '0 0 auto',
      height: 26,
      padding: '0 10px',
      borderRadius: 'var(--radius-pill)',
      border: '1px solid var(--border-subtle)',
      background: 'var(--surface)',
      color: 'var(--text-body)',
      fontSize: 12,
      fontWeight: 'var(--fw-medium)',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, q))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      padding: 8,
      background: 'var(--cz-paper-050)',
      borderRadius: 'var(--radius-lg)',
      border: `1px solid ${focus ? 'var(--cz-lime-500)' : 'var(--border-subtle)'}`,
      transition: 'var(--transition-control)'
    }
  }, /*#__PURE__*/React.createElement("textarea", {
    rows: 1,
    value: value,
    disabled: disabled,
    placeholder: placeholder,
    onChange: e => onChange && onChange(e.target.value),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onKeyDown: e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend && onSend();
      }
    },
    style: {
      flex: 1,
      minWidth: 0,
      resize: 'none',
      maxHeight: 120,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontSize: 13.5,
      lineHeight: 1.5,
      padding: '5px 4px',
      color: 'var(--text-strong)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "paperclip",
    label: "Anexar arquivo",
    size: "sm"
  }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "image",
    label: "Enviar imagem",
    size: "sm"
  }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "mic",
    label: "Gravar \xE1udio",
    size: "sm"
  }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "send",
    label: "Enviar",
    size: "md",
    round: true,
    variant: "primary",
    onClick: onSend,
    style: {
      marginLeft: 4
    }
  }))));
}
Object.assign(__ds_scope, { Composer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/Composer.jsx", error: String((e && e.message) || e) }); }

// components/core/StatCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Headline metric tile used across Início and Resultados. */
function StatCard({
  label,
  value,
  unit,
  delta,
  deltaDirection,
  icon,
  accent = false,
  footnote,
  style,
  ...rest
}) {
  const up = deltaDirection === 'up';
  const good = delta != null && (up ? 'var(--cz-success-700)' : 'var(--cz-danger-700)');
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: accent ? 'var(--cz-lime-400)' : 'var(--surface)',
      border: `1px solid ${accent ? 'transparent' : 'var(--border-hairline)'}`,
      borderRadius: 'var(--radius-card)',
      boxShadow: accent ? 'var(--shadow-accent)' : 'var(--shadow-sm)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      minWidth: 0,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cz-eyebrow",
    style: {
      color: accent ? 'rgba(5,24,19,.62)' : 'var(--text-muted)'
    }
  }, label), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16,
    color: accent ? 'rgba(5,24,19,.55)' : 'var(--cz-ink-400)'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 'var(--text-metric-lg)',
      fontWeight: 600,
      color: accent ? 'var(--cz-ink-900)' : 'var(--text-strong)',
      lineHeight: 1
    }
  }, value), unit && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: accent ? 'rgba(5,24,19,.6)' : 'var(--text-muted)',
      fontWeight: 600
    }
  }, unit), delta != null && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      marginLeft: 'auto',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
      fontSize: 12,
      fontWeight: 600,
      color: accent ? 'rgba(5,24,19,.7)' : good
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: up ? 'trending-up' : 'trending-down',
    size: 13
  }), delta)), footnote && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: accent ? 'rgba(5,24,19,.62)' : 'var(--text-muted)'
    }
  }, footnote));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** User-assigned label (etiqueta). Colour comes from the tag itself, not a tone scale. */
function Tag({
  color = '#b2e54f',
  children,
  onRemove,
  size = 'md',
  style,
  ...rest
}) {
  const sm = size === 'sm';
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: sm ? 5 : 6,
      height: sm ? 20 : 24,
      padding: `0 ${onRemove ? 4 : sm ? 8 : 10}px 0 ${sm ? 8 : 10}px`,
      borderRadius: 'var(--radius-xs)',
      background: 'var(--surface)',
      border: '1px solid var(--border-subtle)',
      color: 'var(--text-body)',
      fontSize: sm ? 11 : 12,
      fontWeight: 'var(--fw-medium)',
      whiteSpace: 'nowrap',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 2,
      background: color,
      flex: '0 0 auto'
    }
  }), children, onRemove && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onRemove,
    "aria-label": "Remover etiqueta",
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 16,
      height: 16,
      border: 'none',
      background: 'transparent',
      color: 'var(--text-faint)',
      cursor: 'pointer',
      borderRadius: 4
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 11
  })));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/BarChart.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Vertical bar series — the only chart primitive in the kit. CSS only, no library. */
function BarChart({
  data = [],
  height = 160,
  tone = 'lime',
  valueFormat,
  style,
  ...rest
}) {
  const max = Math.max(1, ...data.map(d => d.value));
  const fills = {
    lime: 'var(--cz-lime-400)',
    ink: 'var(--cz-ink-900)',
    duo: null
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      height,
      padding: '0 2px',
      borderBottom: '1px solid var(--border-hairline)'
    }
  }, data.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: d.label + i,
    title: `${d.label}: ${d.value}`,
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 5,
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, valueFormat ? valueFormat(d.value) : d.value), /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: `${d.value / max * 100}%`,
      minHeight: 3,
      borderRadius: '6px 6px 2px 2px',
      background: d.highlight ? 'var(--cz-ink-900)' : fills[tone] || fills.lime,
      transition: 'height var(--dur-slow) var(--ease-out)'
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      padding: '0 2px'
    }
  }, data.map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: d.label + i,
    style: {
      flex: 1,
      textAlign: 'center',
      fontSize: 10.5,
      color: 'var(--text-faint)',
      whiteSpace: 'nowrap',
      overflow: 'hidden'
    }
  }, d.label))));
}
Object.assign(__ds_scope, { BarChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/BarChart.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Dense record table. Hairline rows, mono figures, no vertical rules. */
function DataTable({
  columns = [],
  rows = [],
  onRowClick,
  selectable = false,
  selected = [],
  onSelect,
  dense = false,
  empty,
  style,
  ...rest
}) {
  const pad = dense ? '8px 12px' : '11px 14px';
  return /*#__PURE__*/React.createElement("div", _extends({
    className: "cz-scroll",
    style: {
      overflowX: 'auto',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("table", {
    style: {
      minWidth: '100%',
      fontSize: dense ? 12.5 : 13.5
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, selectable && /*#__PURE__*/React.createElement("th", {
    style: {
      width: 36,
      padding: pad,
      background: 'var(--cz-paper-050)',
      borderBottom: '1px solid var(--border-subtle)'
    }
  }), columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: {
      padding: pad,
      textAlign: c.align || 'left',
      whiteSpace: 'nowrap',
      background: 'var(--cz-paper-050)',
      borderBottom: '1px solid var(--border-subtle)',
      fontSize: 'var(--text-eyebrow)',
      letterSpacing: 'var(--ls-eyebrow)',
      textTransform: 'uppercase',
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-muted)',
      width: c.width,
      position: 'sticky',
      top: 0,
      zIndex: 1
    }
  }, c.header)))), /*#__PURE__*/React.createElement("tbody", null, rows.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: columns.length + (selectable ? 1 : 0),
    style: {
      padding: 40,
      textAlign: 'center',
      color: 'var(--text-muted)'
    }
  }, empty || 'Nenhum registro.')), rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: r.id || i,
    onClick: () => onRowClick && onRowClick(r),
    style: {
      cursor: onRowClick ? 'pointer' : undefined,
      transition: 'background-color var(--dur-fast) var(--ease-standard)',
      background: selected.includes(r.id) ? 'var(--cz-lime-050)' : 'transparent'
    },
    onMouseEnter: e => {
      if (!selected.includes(r.id)) e.currentTarget.style.background = 'var(--cz-paper-050)';
    },
    onMouseLeave: e => {
      if (!selected.includes(r.id)) e.currentTarget.style.background = 'transparent';
    }
  }, selectable && /*#__PURE__*/React.createElement("td", {
    style: {
      padding: pad,
      borderBottom: '1px solid var(--border-hairline)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: e => {
      e.stopPropagation();
      onSelect && onSelect(r.id);
    },
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 17,
      height: 17,
      borderRadius: 5,
      cursor: 'pointer',
      background: selected.includes(r.id) ? 'var(--cz-lime-400)' : 'var(--surface)',
      border: `1px solid ${selected.includes(r.id) ? 'var(--cz-lime-500)' : 'var(--border-strong)'}`
    }
  }, selected.includes(r.id) && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 12,
    color: "var(--cz-ink-900)"
  }))), columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    className: c.numeric ? 'cz-num' : undefined,
    style: {
      padding: pad,
      textAlign: c.align || 'left',
      borderBottom: '1px solid var(--border-hairline)',
      color: c.muted ? 'var(--text-muted)' : 'var(--text-body)',
      fontWeight: c.strong ? 'var(--fw-semibold)' : 'var(--fw-regular)',
      whiteSpace: c.wrap ? 'normal' : 'nowrap'
    }
  }, c.render ? c.render(r) : r[c.key])))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/DonutChart.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Conic-gradient ring for share-of-total figures. CSS only. */
function DonutChart({
  segments = [],
  size = 132,
  thickness = 16,
  centerLabel,
  centerValue,
  style,
  ...rest
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  const stops = segments.map(s => {
    const from = acc / total * 100;
    acc += s.value;
    return `${s.color} ${from}% ${acc / total * 100}%`;
  }).join(',');
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      flexWrap: 'wrap',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size,
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      borderRadius: '50%',
      background: `conic-gradient(${stops})`,
      mask: `radial-gradient(circle, transparent ${size / 2 - thickness}px, #000 ${size / 2 - thickness + 1}px)`,
      WebkitMask: `radial-gradient(circle, transparent ${size / 2 - thickness}px, #000 ${size / 2 - thickness + 1}px)`
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'grid',
      placeItems: 'center',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 20,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, centerValue), centerLabel && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: 'var(--text-muted)'
    }
  }, centerLabel)))), /*#__PURE__*/React.createElement("ul", {
    style: {
      margin: 0,
      padding: 0,
      listStyle: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minWidth: 0
    }
  }, segments.map(s => /*#__PURE__*/React.createElement("li", {
    key: s.label,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: s.color,
      flex: '0 0 auto'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-body)'
    }
  }, s.label), /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      marginLeft: 'auto',
      color: 'var(--text-muted)',
      paddingLeft: 12
    }
  }, s.value)))));
}
Object.assign(__ds_scope, { DonutChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DonutChart.jsx", error: String((e && e.message) || e) }); }

// components/data/EmptyState.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Zero-state block. Quiet, never apologetic, always offers the next action. */
function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  compact = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: compact ? 8 : 12,
      padding: compact ? '28px 20px' : '56px 24px',
      textAlign: 'center',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center',
      width: compact ? 38 : 52,
      height: compact ? 38 : 52,
      borderRadius: 'var(--radius-lg)',
      background: 'var(--cz-lime-050)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: compact ? 18 : 24,
    color: "var(--cz-lime-700)"
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: compact ? 14 : 16,
      letterSpacing: '-0.01em'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--text-muted)',
      maxWidth: '44ch'
    }
  }, description), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/data/ProgressBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Thin progress meter for funnel stages, goals and AI resolution rates. */
function ProgressBar({
  value = 0,
  max = 100,
  tone = 'lime',
  label,
  caption,
  size = 'md',
  style,
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, value / max * 100));
  const fills = {
    lime: 'var(--cz-lime-400)',
    ink: 'var(--cz-ink-900)',
    success: 'var(--cz-success-500)',
    warning: 'var(--cz-warning-500)',
    danger: 'var(--cz-danger-500)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      width: '100%',
      ...style
    }
  }, rest), (label || caption) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: 'var(--text-body)',
      fontWeight: 'var(--fw-medium)'
    }
  }, label), caption && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, caption)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: size === 'sm' ? 4 : 7,
      borderRadius: 'var(--radius-pill)',
      background: 'var(--surface-sunken)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${pct}%`,
      height: '100%',
      borderRadius: 'var(--radius-pill)',
      background: fills[tone] || fills.lime,
      transition: 'width var(--dur-slow) var(--ease-out)'
    }
  })));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Banner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  info: {
    bg: 'var(--cz-info-050)',
    fg: 'var(--cz-info-700)',
    icon: 'info'
  },
  success: {
    bg: 'var(--cz-success-050)',
    fg: 'var(--cz-success-700)',
    icon: 'circle-check'
  },
  warning: {
    bg: 'var(--cz-warning-050)',
    fg: 'var(--cz-warning-700)',
    icon: 'triangle-alert'
  },
  danger: {
    bg: 'var(--cz-danger-050)',
    fg: 'var(--cz-danger-700)',
    icon: 'octagon-alert'
  },
  lime: {
    bg: 'var(--cz-lime-050)',
    fg: 'var(--cz-lime-800)',
    icon: 'sparkles'
  }
};

/** Inline, persistent message bound to a region of the page. */
function Banner({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  icon,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.info;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 11,
      padding: '12px 14px',
      background: t.bg,
      borderRadius: 'var(--radius-md)',
      color: t.fg,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon || t.icon,
    size: 17,
    style: {
      marginTop: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, title && /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 13.5,
      fontWeight: 'var(--fw-bold)'
    }
  }, title), children && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      opacity: 0.92
    }
  }, children)), action, onDismiss && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onDismiss,
    "aria-label": "Dispensar",
    style: {
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      opacity: 0.6,
      cursor: 'pointer',
      padding: 0,
      display: 'grid',
      placeItems: 'center',
      width: 20,
      height: 20
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 14
  })));
}
Object.assign(__ds_scope, { Banner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Banner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Modal.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Centred dialog with scrim. Body scrolls; header and footer stay put. */
function Modal({
  open = true,
  title,
  description,
  children,
  footer,
  onClose,
  width = 480,
  style,
  ...rest
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 100,
      display: 'grid',
      placeItems: 'center',
      background: 'var(--overlay-scrim)',
      backdropFilter: 'blur(3px)',
      padding: 24,
      animation: 'cz-fade var(--dur-base) var(--ease-out)'
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", _extends({
    onClick: e => e.stopPropagation(),
    style: {
      width: '100%',
      maxWidth: width,
      maxHeight: '86vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-lg)',
      overflow: 'hidden',
      animation: 'cz-rise var(--dur-base) var(--ease-out)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '18px 20px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 'var(--text-h2)',
      letterSpacing: 'var(--ls-h2)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13,
      color: 'var(--text-muted)'
    }
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "Fechar",
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 30,
      height: 30,
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      background: 'transparent',
      color: 'var(--text-muted)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 17
  }))), /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '0 20px 18px'
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      padding: '14px 20px',
      borderTop: '1px solid var(--border-hairline)',
      background: 'var(--cz-paper-050)'
    }
  }, footer)), /*#__PURE__*/React.createElement("style", null, '@keyframes cz-fade{from{opacity:0}to{opacity:1}}@keyframes cz-rise{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}'));
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Modal.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const ICONS = {
  success: 'circle-check',
  danger: 'octagon-alert',
  info: 'info',
  warning: 'triangle-alert'
};

/** Transient confirmation, bottom-right. Dark ground so it reads over any page. */
function Toast({
  tone = 'success',
  title,
  description,
  action,
  onDismiss,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    className: "cz-dark",
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 11,
      minWidth: 280,
      maxWidth: 400,
      padding: '12px 14px',
      background: 'var(--cz-ink-900)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-pop)',
      color: 'var(--cz-cream-050)',
      animation: 'cz-toast var(--dur-slow) var(--ease-out)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: ICONS[tone] || ICONS.info,
    size: 17,
    color: tone === 'danger' ? '#f2a08c' : 'var(--cz-lime-400)',
    style: {
      marginTop: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 13.5,
      fontWeight: 'var(--fw-bold)'
    }
  }, title), description && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: 'rgba(251,252,232,.66)'
    }
  }, description)), action, onDismiss && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onDismiss,
    "aria-label": "Fechar",
    style: {
      border: 'none',
      background: 'transparent',
      color: 'rgba(251,252,232,.5)',
      cursor: 'pointer',
      padding: 0,
      display: 'grid',
      placeItems: 'center',
      width: 20,
      height: 20
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 14
  })), /*#__PURE__*/React.createElement("style", null, '@keyframes cz-toast{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}'));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Hover label on dense chrome. Dark capsule, 6px radius, no arrow. */
function Tooltip({
  label,
  side = 'top',
  children,
  style,
  ...rest
}) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: {
      bottom: 'calc(100% + 6px)',
      left: '50%',
      transform: 'translateX(-50%)'
    },
    bottom: {
      top: 'calc(100% + 6px)',
      left: '50%',
      transform: 'translateX(-50%)'
    },
    left: {
      right: 'calc(100% + 6px)',
      top: '50%',
      transform: 'translateY(-50%)'
    },
    right: {
      left: 'calc(100% + 6px)',
      top: '50%',
      transform: 'translateY(-50%)'
    }
  }[side];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    },
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false)
  }, rest), children, show && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      ...pos,
      zIndex: 60,
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      padding: '5px 8px',
      borderRadius: 'var(--radius-xs)',
      background: 'var(--cz-ink-900)',
      color: 'var(--cz-cream-050)',
      fontSize: 11.5,
      fontWeight: 'var(--fw-medium)',
      boxShadow: 'var(--shadow-md)',
      animation: 'cz-fade var(--dur-fast) var(--ease-out)'
    }
  }, label), /*#__PURE__*/React.createElement("style", null, '@keyframes cz-fade{from{opacity:0}to{opacity:1}}'));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Checkbox with the lime fill. Also does the indeterminate table-header state. */
function Checkbox({
  checked = false,
  indeterminate = false,
  label,
  description,
  disabled = false,
  onChange,
  style,
  ...rest
}) {
  const on = checked || indeterminate;
  return /*#__PURE__*/React.createElement("label", _extends({
    style: {
      display: 'inline-flex',
      alignItems: description ? 'flex-start' : 'center',
      gap: 9,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    role: "checkbox",
    "aria-checked": indeterminate ? 'mixed' : checked,
    tabIndex: disabled ? -1 : 0,
    onClick: () => !disabled && onChange && onChange(!checked),
    onKeyDown: e => {
      if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        onChange && onChange(!checked);
      }
    },
    style: {
      width: 17,
      height: 17,
      flex: '0 0 auto',
      marginTop: description ? 2 : 0,
      borderRadius: 5,
      display: 'grid',
      placeItems: 'center',
      background: on ? 'var(--cz-lime-400)' : 'var(--surface)',
      border: `1px solid ${on ? 'var(--cz-lime-500)' : 'var(--border-strong)'}`,
      transition: 'var(--transition-control)'
    }
  }, on && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: indeterminate ? 'minus' : 'check',
    size: 12,
    color: "var(--cz-ink-900)"
  })), (label || description) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-body)',
      fontWeight: 'var(--fw-medium)'
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Dropdown.jsx
try { (() => {
/** Dropdown trigger + menu used for filters, row actions and status pickers. */
function Dropdown({
  trigger,
  items = [],
  align = 'left',
  width = 200,
  onSelect,
  style
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const away = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    style: {
      position: 'relative',
      display: 'inline-flex',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: () => setOpen(o => !o)
  }, trigger), open && /*#__PURE__*/React.createElement("div", {
    role: "menu",
    style: {
      position: 'absolute',
      top: 'calc(100% + 6px)',
      [align]: 0,
      zIndex: 40,
      width,
      background: 'var(--surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-pop)',
      padding: 5,
      animation: 'cz-pop var(--dur-fast) var(--ease-out)'
    }
  }, items.map((it, i) => it.divider ? /*#__PURE__*/React.createElement("div", {
    key: `d${i}`,
    style: {
      height: 1,
      background: 'var(--border-hairline)',
      margin: '5px 0'
    }
  }) : /*#__PURE__*/React.createElement("button", {
    key: it.value || it.label,
    type: "button",
    role: "menuitem",
    onClick: () => {
      setOpen(false);
      onSelect && onSelect(it.value || it.label);
      it.onClick && it.onClick();
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      width: '100%',
      padding: '7px 9px',
      border: 'none',
      borderRadius: 'var(--radius-xs)',
      background: 'transparent',
      color: it.danger ? 'var(--cz-danger-700)' : 'var(--text-body)',
      fontSize: 13,
      fontWeight: 'var(--fw-medium)',
      textAlign: 'left',
      cursor: 'pointer'
    },
    onMouseEnter: e => {
      e.currentTarget.style.background = it.danger ? 'var(--cz-danger-050)' : 'var(--cz-ink-050)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = 'transparent';
    }
  }, it.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon,
    size: 15
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, it.label), it.shortcut && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, it.shortcut), it.checked && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 14,
    color: "var(--cz-lime-700)"
  }))), /*#__PURE__*/React.createElement("style", null, '@keyframes cz-pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}')));
}
Object.assign(__ds_scope, { Dropdown });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Dropdown.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const H = {
  sm: 'var(--control-h-sm)',
  md: 'var(--control-h-md)',
  lg: 'var(--control-h-lg)'
};

/** Text field with optional label, leading icon, suffix and error state. */
function Input({
  label,
  hint,
  error,
  icon,
  suffix,
  size = 'md',
  block = true,
  style,
  wrapStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const bd = error ? 'var(--cz-danger-500)' : focus ? 'var(--cz-lime-500)' : 'var(--border-subtle)';
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: block ? 'flex' : 'inline-flex',
      flexDirection: 'column',
      gap: 6,
      width: block ? '100%' : undefined,
      ...wrapStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-label)',
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-body)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      height: H[size] || H.md,
      padding: '0 12px',
      background: 'var(--surface)',
      border: `1px solid ${bd}`,
      borderRadius: 'var(--radius-control)',
      boxShadow: focus ? 'var(--focus-ring)' : 'var(--shadow-xs)',
      transition: 'var(--transition-control)'
    }
  }, icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 15,
    color: "var(--cz-ink-400)"
  }), /*#__PURE__*/React.createElement("input", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontSize: size === 'sm' ? 13 : 14,
      color: 'var(--text-strong)',
      ...style
    }
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-faint)',
      whiteSpace: 'nowrap'
    }
  }, suffix)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-caption)',
      color: error ? 'var(--cz-danger-700)' : 'var(--text-muted)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** The global/contextual search field. Pill-shaped, sunken, no shadow. */
function SearchField({
  placeholder = 'Buscar…',
  value,
  onChange,
  shortcut,
  size = 'md',
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: '100%',
      height: size === 'sm' ? 'var(--control-h-sm)' : 'var(--control-h-md)',
      padding: '0 10px',
      borderRadius: 'var(--radius-pill)',
      background: focus ? 'var(--surface)' : 'var(--surface-sunken)',
      border: `1px solid ${focus ? 'var(--cz-lime-500)' : 'transparent'}`,
      boxShadow: focus ? 'var(--focus-ring)' : 'none',
      transition: 'var(--transition-control)',
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search",
    size: 15,
    color: "var(--cz-ink-400)"
  }), /*#__PURE__*/React.createElement("input", _extends({
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontSize: 13,
      color: 'var(--text-strong)'
    }
  }, rest)), shortcut && /*#__PURE__*/React.createElement("kbd", {
    className: "cz-num",
    style: {
      fontSize: 10,
      padding: '2px 5px',
      borderRadius: 5,
      background: 'var(--surface)',
      border: '1px solid var(--border-subtle)',
      color: 'var(--text-faint)'
    }
  }, shortcut));
}
Object.assign(__ds_scope, { SearchField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchField.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedControl.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Two-to-four mutually exclusive views. Sunken track, white selected pill. */
function SegmentedControl({
  options = [],
  value,
  onChange,
  size = 'md',
  block = false,
  style,
  ...rest
}) {
  const items = options.map(o => typeof o === 'string' ? {
    value: o,
    label: o
  } : o);
  const h = size === 'sm' ? 28 : 34;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: block ? 'flex' : 'inline-flex',
      width: block ? '100%' : undefined,
      padding: 3,
      gap: 2,
      background: 'var(--surface-sunken)',
      borderRadius: 'var(--radius-control)',
      ...style
    }
  }, rest), items.map(o => {
    const on = o.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: o.value,
      type: "button",
      role: "tab",
      "aria-selected": on,
      onClick: () => onChange && onChange(o.value),
      style: {
        flex: block ? 1 : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: h,
        padding: '0 12px',
        border: 'none',
        borderRadius: 7,
        background: on ? 'var(--surface)' : 'transparent',
        boxShadow: on ? 'var(--shadow-xs)' : 'none',
        color: on ? 'var(--text-strong)' : 'var(--text-muted)',
        fontSize: size === 'sm' ? 12 : 13,
        fontWeight: 'var(--fw-semibold)',
        cursor: 'pointer',
        transition: 'var(--transition-control)',
        whiteSpace: 'nowrap'
      }
    }, o.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: o.icon,
      size: 14
    }), o.label, o.count != null && /*#__PURE__*/React.createElement("span", {
      className: "cz-num",
      style: {
        fontSize: 11,
        color: 'var(--text-faint)'
      }
    }, o.count));
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Native select wearing the Conduzza control shell. */
function Select({
  label,
  hint,
  error,
  options = [],
  size = 'md',
  block = true,
  style,
  wrapStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const bd = error ? 'var(--cz-danger-500)' : focus ? 'var(--cz-lime-500)' : 'var(--border-subtle)';
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: block ? 'flex' : 'inline-flex',
      flexDirection: 'column',
      gap: 6,
      width: block ? '100%' : undefined,
      ...wrapStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-label)',
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-body)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      height: size === 'sm' ? 'var(--control-h-sm)' : 'var(--control-h-md)',
      background: 'var(--surface)',
      border: `1px solid ${bd}`,
      borderRadius: 'var(--radius-control)',
      boxShadow: focus ? 'var(--focus-ring)' : 'var(--shadow-xs)',
      transition: 'var(--transition-control)'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      appearance: 'none',
      width: '100%',
      height: '100%',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      padding: '0 32px 0 12px',
      fontSize: size === 'sm' ? 13 : 14,
      color: 'var(--text-strong)',
      cursor: 'pointer',
      ...style
    }
  }, rest), options.map(o => {
    const opt = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  })), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 15,
    color: "var(--cz-ink-400)",
    style: {
      position: 'absolute',
      right: 10,
      pointerEvents: 'none'
    }
  })), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-caption)',
      color: error ? 'var(--cz-danger-700)' : 'var(--text-muted)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** On/off toggle. Every automation and permission row uses this. */
function Switch({
  checked = false,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
  style,
  ...rest
}) {
  const w = size === 'sm' ? 32 : 40,
    h = size === 'sm' ? 18 : 22,
    k = h - 6;
  return /*#__PURE__*/React.createElement("label", _extends({
    style: {
      display: 'inline-flex',
      alignItems: description ? 'flex-start' : 'center',
      gap: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    role: "switch",
    "aria-checked": checked,
    tabIndex: disabled ? -1 : 0,
    onClick: () => !disabled && onChange && onChange(!checked),
    onKeyDown: e => {
      if (!disabled && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        onChange && onChange(!checked);
      }
    },
    style: {
      position: 'relative',
      width: w,
      height: h,
      flex: '0 0 auto',
      marginTop: description ? 1 : 0,
      borderRadius: 'var(--radius-pill)',
      background: checked ? 'var(--cz-lime-400)' : 'var(--cz-ink-200)',
      transition: 'background-color var(--dur-base) var(--ease-standard)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 3,
      left: checked ? w - k - 3 : 3,
      width: k,
      height: k,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 2px rgba(5,24,19,.25)',
      transition: 'left var(--dur-base) var(--ease-out)'
    }
  })), (label || description) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-body)',
      fontWeight: 'var(--fw-medium)'
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, description)));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Multi-line field for message templates, notes and AI prompts. */
function Textarea({
  label,
  hint,
  error,
  rows = 4,
  counter,
  value,
  block = true,
  style,
  wrapStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const bd = error ? 'var(--cz-danger-500)' : focus ? 'var(--cz-lime-500)' : 'var(--border-subtle)';
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: block ? 'flex' : 'inline-flex',
      flexDirection: 'column',
      gap: 6,
      width: block ? '100%' : undefined,
      ...wrapStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--text-label)',
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-body)'
    }
  }, label), /*#__PURE__*/React.createElement("textarea", _extends({
    rows: rows,
    value: value,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      resize: 'vertical',
      padding: '10px 12px',
      background: 'var(--surface)',
      border: `1px solid ${bd}`,
      borderRadius: 'var(--radius-control)',
      outline: 'none',
      boxShadow: focus ? 'var(--focus-ring)' : 'var(--shadow-xs)',
      fontSize: 14,
      lineHeight: 'var(--lh-body-md)',
      color: 'var(--text-strong)',
      transition: 'var(--transition-control)',
      ...style
    }
  }, rest)), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 8,
      fontSize: 'var(--text-caption)',
      color: error ? 'var(--cz-danger-700)' : 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, error || hint), counter != null && /*#__PURE__*/React.createElement("span", {
    className: "cz-num"
  }, String(value || '').length, "/", counter)));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// components/navigation/PageHeader.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Section header inside a page: title, supporting line, right-aligned actions. */
function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 16,
      flexWrap: 'wrap',
      marginBottom: 16,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, eyebrow && /*#__PURE__*/React.createElement("span", {
    className: "cz-eyebrow"
  }, eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 'var(--text-h1)',
      letterSpacing: 'var(--ls-h1)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      color: 'var(--text-muted)',
      maxWidth: '62ch'
    }
  }, description), children), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, actions));
}
Object.assign(__ds_scope, { PageHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SidebarNav.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** The persistent left rail. Dark ground, lime marks the current page. */
function SidebarNav({
  items = [],
  active,
  onNavigate,
  collapsed = false,
  brand,
  footer,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("nav", _extends({
    className: "cz-dark cz-scroll",
    style: {
      width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)',
      flex: '0 0 auto',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--cz-ink-900)',
      borderRight: '1px solid rgba(251,252,232,.07)',
      transition: 'width var(--dur-base) var(--ease-standard)',
      overflow: 'hidden',
      ...style
    }
  }, rest), brand && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: collapsed ? '16px 12px' : '16px 18px',
      flex: '0 0 auto'
    }
  }, brand), /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: collapsed ? '4px 8px' : '4px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, items.map(it => it.section ? /*#__PURE__*/React.createElement("div", {
    key: it.section,
    className: "cz-eyebrow",
    style: {
      padding: collapsed ? '14px 0 6px' : '16px 8px 6px',
      color: 'rgba(251,252,232,.32)',
      opacity: collapsed ? 0 : 1,
      height: collapsed ? 12 : undefined
    }
  }, it.section) : /*#__PURE__*/React.createElement("button", {
    key: it.id,
    type: "button",
    onClick: () => onNavigate && onNavigate(it.id),
    title: collapsed ? it.label : undefined,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      width: '100%',
      padding: collapsed ? '9px 0' : '9px 10px',
      justifyContent: collapsed ? 'center' : 'flex-start',
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: it.id === active ? 'rgba(178,229,79,.14)' : 'transparent',
      color: it.id === active ? 'var(--cz-lime-400)' : 'rgba(251,252,232,.62)',
      fontSize: 13.5,
      fontWeight: it.id === active ? 'var(--fw-semibold)' : 'var(--fw-medium)',
      textAlign: 'left',
      transition: 'var(--transition-control)',
      position: 'relative'
    },
    onMouseEnter: e => {
      if (it.id !== active) {
        e.currentTarget.style.background = 'rgba(251,252,232,.05)';
        e.currentTarget.style.color = 'var(--cz-cream-050)';
      }
    },
    onMouseLeave: e => {
      if (it.id !== active) {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'rgba(251,252,232,.62)';
      }
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: it.icon,
    size: 17
  }), !collapsed && /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, it.label), !collapsed && it.count != null && /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 11,
      fontWeight: 700,
      padding: '1px 6px',
      borderRadius: 'var(--radius-pill)',
      background: it.id === active ? 'var(--cz-lime-400)' : 'rgba(251,252,232,.10)',
      color: it.id === active ? 'var(--cz-ink-900)' : 'rgba(251,252,232,.72)'
    }
  }, it.count)))), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: '0 0 auto',
      padding: collapsed ? 8 : 12,
      borderTop: '1px solid rgba(251,252,232,.07)'
    }
  }, footer));
}
Object.assign(__ds_scope, { SidebarNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SidebarNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Underlined tabs for in-page sections (five or more views). */
function Tabs({
  items = [],
  value,
  onChange,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      borderBottom: '1px solid var(--border-hairline)',
      overflowX: 'auto',
      ...style
    }
  }, rest), items.map(o => {
    const it = typeof o === 'string' ? {
      value: o,
      label: o
    } : o;
    const on = it.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      type: "button",
      role: "tab",
      "aria-selected": on,
      onClick: () => onChange && onChange(it.value),
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '10px 12px 11px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        color: on ? 'var(--text-strong)' : 'var(--text-muted)',
        fontSize: 13.5,
        fontWeight: on ? 'var(--fw-bold)' : 'var(--fw-medium)',
        boxShadow: on ? 'inset 0 -2px 0 var(--cz-lime-400)' : 'none',
        transition: 'var(--transition-control)'
      }
    }, it.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon,
      size: 15
    }), it.label, it.count != null && /*#__PURE__*/React.createElement("span", {
      className: "cz-num",
      style: {
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--surface-sunken)',
        color: 'var(--text-muted)'
      }
    }, it.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/TopBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** App top bar: page title on the left, global tools on the right. */
function TopBar({
  title,
  subtitle,
  breadcrumb,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("header", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flex: '0 0 auto',
      height: 'var(--topbar-h)',
      padding: '0 var(--page-gutter)',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border-hairline)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 1
    }
  }, breadcrumb && /*#__PURE__*/React.createElement("span", {
    className: "cz-eyebrow"
  }, breadcrumb), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 'var(--text-h2)',
      letterSpacing: 'var(--ls-h2)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, subtitle)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      minWidth: 0
    }
  }, children));
}
Object.assign(__ds_scope, { TopBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/TopBar.jsx", error: String((e && e.message) || e) }); }

// components/scheduling/AppointmentCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const STATUS = {
  confirmado: {
    bar: 'var(--cz-success-500)',
    bg: 'var(--cz-success-050)',
    fg: 'var(--cz-success-700)',
    label: 'Confirmado',
    icon: 'check'
  },
  aguardando: {
    bar: 'var(--cz-warning-500)',
    bg: 'var(--cz-warning-050)',
    fg: 'var(--cz-warning-700)',
    label: 'Aguardando',
    icon: 'clock'
  },
  cancelado: {
    bar: 'var(--cz-danger-500)',
    bg: 'var(--cz-danger-050)',
    fg: 'var(--cz-danger-700)',
    label: 'Cancelado',
    icon: 'x'
  },
  encaixe: {
    bar: 'var(--cz-lime-500)',
    bg: 'var(--cz-lime-050)',
    fg: 'var(--cz-lime-800)',
    label: 'Encaixe',
    icon: 'zap'
  },
  bloqueio: {
    bar: 'var(--cz-ink-400)',
    bg: 'var(--cz-ink-050)',
    fg: 'var(--cz-ink-600)',
    label: 'Bloqueio',
    icon: 'ban'
  }
};

/** A booking on the Agenda grid. Left status bar, patient, procedure, time. */
function AppointmentCard({
  patient,
  procedure,
  start,
  end,
  status = 'aguardando',
  professional,
  room,
  compact = false,
  onClick,
  style,
  ...rest
}) {
  const s = STATUS[status] || STATUS.aguardando;
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("article", _extends({
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      gap: 0,
      overflow: 'hidden',
      cursor: 'pointer',
      background: s.bg,
      borderRadius: 'var(--radius-sm)',
      boxShadow: hover ? 'var(--shadow-sm)' : 'none',
      transition: 'box-shadow var(--dur-fast) var(--ease-standard)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      flex: '0 0 auto',
      background: s.bar
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      padding: compact ? '4px 7px' : '7px 9px',
      display: 'flex',
      flexDirection: 'column',
      gap: compact ? 1 : 3
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 10.5,
      color: s.fg,
      fontWeight: 600
    }
  }, start, end ? `–${end}` : ''), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: s.icon,
    size: 10,
    color: s.fg
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: compact ? 11.5 : 12.5,
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-strong)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, patient), !compact && procedure && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-muted)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, procedure), !compact && (professional || room) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--text-faint)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, [professional, room].filter(Boolean).join(' · '))));
}
Object.assign(__ds_scope, { AppointmentCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/scheduling/AppointmentCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/conduzza-chat/app.jsx
try { (() => {
const DSapp = window.ConduzzaDesignSystem_cea3ac;
const {
  SidebarNav,
  TopBar,
  SearchField,
  IconButton,
  Avatar,
  Badge,
  Toast,
  Button,
  Icon
} = DSapp;
const TITLES = {
  inicio: ['Início', 'Painel do dia'],
  atendimento: ['Atendimento', 'Conversas de WhatsApp'],
  leads: ['Leads', 'Contatos que ainda não viraram pacientes'],
  agenda: ['Agenda', 'Todos os profissionais'],
  pacientes: ['Pacientes', 'Base de contatos atendidos'],
  confirmacoes: ['Confirmações', 'Consultas de hoje'],
  espera: ['Lista de espera', 'Encaixes e cancelamentos'],
  resultados: ['Resultados', 'Marketing, comercial e IA'],
  ia: ['Agente de IA', 'Configuração do atendimento automático'],
  automacoes: ['Automações', 'Fluxos pré-definidos'],
  cadastro: ['Cadastro', 'Profissionais, procedimentos e unidades'],
  config: ['Configurações', 'Usuários, conexões e estrutura']
};
const SCREENS = {
  inicio: go => /*#__PURE__*/React.createElement(ScreenInicio, {
    go: go
  }),
  atendimento: () => /*#__PURE__*/React.createElement(ScreenAtendimento, null),
  leads: () => /*#__PURE__*/React.createElement(ScreenLeads, null),
  agenda: () => /*#__PURE__*/React.createElement(ScreenAgenda, null),
  pacientes: () => /*#__PURE__*/React.createElement(ScreenPacientes, null),
  confirmacoes: () => /*#__PURE__*/React.createElement(ScreenConfirmacoes, null),
  espera: () => /*#__PURE__*/React.createElement(ScreenEspera, null),
  resultados: () => /*#__PURE__*/React.createElement(ScreenResultados, null),
  ia: () => /*#__PURE__*/React.createElement(ScreenIA, null),
  automacoes: () => /*#__PURE__*/React.createElement(ScreenAutomacoes, null),
  cadastro: () => /*#__PURE__*/React.createElement(ScreenCadastro, null),
  config: () => /*#__PURE__*/React.createElement(ScreenConfig, null)
};
function App() {
  const [page, setPage] = React.useState('inicio');
  const [collapsed, setCollapsed] = React.useState(false);
  const [toast, setToast] = React.useState(false);
  const go = id => {
    setPage(id);
  };
  const [title, sub] = TITLES[page] || TITLES.inicio;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--canvas)'
    }
  }, /*#__PURE__*/React.createElement(SidebarNav, {
    collapsed: collapsed,
    items: NAV,
    active: page,
    onNavigate: go,
    brand: collapsed ? /*#__PURE__*/React.createElement("img", {
      src: "../../assets/symbol-lime.png",
      alt: "Conduzza",
      style: {
        width: 26,
        height: 26,
        margin: '0 auto'
      }
    }) : /*#__PURE__*/React.createElement("img", {
      src: "../../assets/logo-lockup-on-dark.png",
      alt: "Conduzza",
      style: {
        height: 20,
        width: 'auto'
      }
    }),
    footer: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 9
      }
    }, /*#__PURE__*/React.createElement(Avatar, {
      name: CLINIC.user,
      size: "sm",
      status: "online"
    }), !collapsed && /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12.5,
        fontWeight: 600,
        color: 'var(--cz-cream-050)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, CLINIC.user), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10.5,
        color: 'var(--cz-ink-400)'
      }
    }, CLINIC.role)), !collapsed && /*#__PURE__*/React.createElement(IconButton, {
      icon: "log-out",
      label: "Sair",
      size: "sm",
      style: {
        color: 'rgba(251,252,232,.45)'
      }
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement(TopBar, {
    title: title,
    breadcrumb: `${CLINIC.name.toUpperCase()} · ${CLINIC.unit.toUpperCase()}`
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: collapsed ? 'panel-left-open' : 'panel-left-close',
    label: "Recolher menu",
    onClick: () => setCollapsed(c => !c)
  }), /*#__PURE__*/React.createElement(SearchField, {
    shortcut: "\u2318K",
    placeholder: "Buscar conversas, pacientes, telefones\u2026",
    style: {
      width: 300
    }
  }), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true,
    size: "sm"
  }, "WhatsApp on-line"), /*#__PURE__*/React.createElement(IconButton, {
    icon: "bell",
    label: "Notifica\xE7\xF5es",
    badge: 3,
    onClick: () => setToast(true)
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "circle-help",
    label: "Ajuda"
  }), /*#__PURE__*/React.createElement(Avatar, {
    name: CLINIC.user,
    size: "sm"
  })), /*#__PURE__*/React.createElement("main", {
    className: "cz-scroll",
    style: {
      flex: 1,
      minHeight: 0,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'auto'
    }
  }, (SCREENS[page] || SCREENS.inicio)(go)))), toast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      right: 20,
      bottom: 20,
      zIndex: 200
    }
  }, /*#__PURE__*/React.createElement(Toast, {
    title: "3 novas mensagens",
    description: "Tatiane Moraes, Sofia Duarte e mais 1.",
    onDismiss: () => setToast(false),
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      style: {
        color: 'var(--cz-lime-400)'
      },
      onClick: () => {
        setToast(false);
        go('atendimento');
      }
    }, "Abrir")
  })));
}

// Babel executes external text/babel files as they resolve, not in document
// order — so wait until every screen and the mock data have registered.
const DEPS = ['NAV', 'CLINIC', 'ScreenInicio', 'ScreenAtendimento', 'ScreenLeads', 'ScreenAgenda', 'ScreenPacientes', 'ScreenConfirmacoes', 'ScreenEspera', 'ScreenResultados', 'ScreenIA', 'ScreenAutomacoes', 'ScreenCadastro', 'ScreenConfig'];
function boot() {
  if (DEPS.some(d => !window[d])) {
    requestAnimationFrame(boot);
    return;
  }
  if (!window.__czRoot) window.__czRoot = ReactDOM.createRoot(document.getElementById('root'));
  window.__czRoot.render(/*#__PURE__*/React.createElement(App, null));
}
boot();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/conduzza-chat/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/conduzza-chat/data.jsx
try { (() => {
// Mock data for the Conduzza Chat UI kit. Nothing here is real patient data.
const CLINIC = {
  name: 'Clínica Vitta',
  unit: 'Unidade Centro',
  user: 'Rafaela Souza',
  role: 'Atendimento'
};
const NAV = [{
  id: 'inicio',
  label: 'Início',
  icon: 'house'
}, {
  id: 'atendimento',
  label: 'Atendimento',
  icon: 'messages-square',
  count: 12
}, {
  id: 'leads',
  label: 'Leads',
  icon: 'user-plus',
  count: 38
}, {
  id: 'agenda',
  label: 'Agenda',
  icon: 'calendar-days'
}, {
  id: 'pacientes',
  label: 'Pacientes',
  icon: 'users'
}, {
  section: 'Operação do dia'
}, {
  id: 'confirmacoes',
  label: 'Confirmações',
  icon: 'calendar-check',
  count: 19
}, {
  id: 'espera',
  label: 'Lista de espera',
  icon: 'clock',
  count: 7
}, {
  id: 'resultados',
  label: 'Resultados',
  icon: 'chart-column'
}, {
  section: 'Inteligência'
}, {
  id: 'ia',
  label: 'Agente de IA',
  icon: 'sparkles'
}, {
  id: 'automacoes',
  label: 'Automações',
  icon: 'workflow'
}, {
  section: 'Administração'
}, {
  id: 'cadastro',
  label: 'Cadastro',
  icon: 'folder-cog'
}, {
  id: 'config',
  label: 'Configurações',
  icon: 'settings'
}];
const TAGS = {
  primeira: {
    label: 'Primeira consulta',
    color: '#b2e54f'
  },
  remarcacao: {
    label: 'Remarcação',
    color: '#d9962a'
  },
  convenio: {
    label: 'Convênio',
    color: '#4785b5'
  },
  meta: {
    label: 'Meta Ads',
    color: '#0866ff'
  },
  indicacao: {
    label: 'Indicação',
    color: '#2f9e5b'
  },
  urgente: {
    label: 'Urgente',
    color: '#d4553d'
  }
};
const CONVERSAS = [{
  id: 'c1',
  name: 'Mariana Alves',
  phone: '(11) 98812-4409',
  preview: 'Consigo remarcar pra quinta?',
  time: '14:28',
  unread: 2,
  tags: [TAGS.remarcacao],
  assignee: 'Rafaela',
  stage: 'Em atendimento'
}, {
  id: 'c2',
  name: 'Paulo Nogueira',
  phone: '(11) 99714-2280',
  preview: 'Horários disponíveis: 10:30, 15:00',
  time: '13:02',
  unread: 0,
  aiHandled: true,
  tags: [TAGS.primeira],
  stage: 'Agente de IA'
}, {
  id: 'c3',
  name: 'Tatiane Moraes',
  phone: '(21) 98130-7755',
  preview: 'Bom dia! Qual o valor da harmonização?',
  time: '11:47',
  unread: 1,
  tags: [TAGS.meta],
  stage: 'Novo'
}, {
  id: 'c4',
  name: 'Camila Fontes',
  phone: '(11) 97455-1120',
  preview: 'Obrigada! Até quinta então 😊',
  time: '10:15',
  unread: 0,
  tags: [TAGS.convenio],
  assignee: 'Diego',
  stage: 'Resolvido'
}, {
  id: 'c5',
  name: 'Bruno Tavares',
  phone: '(11) 99631-8842',
  preview: 'Vocês atendem Unimed?',
  time: 'ontem',
  unread: 0,
  tags: [TAGS.convenio],
  assignee: 'Rafaela',
  stage: 'Em atendimento'
}, {
  id: 'c6',
  name: 'Renata Lopes',
  phone: '(11) 98120-3377',
  preview: 'Agente: enviei o endereço da unidade.',
  time: 'ontem',
  unread: 0,
  aiHandled: true,
  stage: 'Agente de IA'
}, {
  id: 'c7',
  name: 'Sofia Duarte',
  phone: '(11) 99002-4418',
  preview: 'Preciso cancelar, surgiu um imprevisto.',
  time: 'ontem',
  unread: 0,
  tags: [TAGS.urgente],
  stage: 'Novo'
}, {
  id: 'c8',
  name: 'Eduardo Prado',
  phone: '(11) 98771-6603',
  preview: 'Confirmado, obrigado!',
  time: 'seg',
  unread: 0,
  stage: 'Resolvido'
}];
const THREAD = [{
  from: 'in',
  time: '14:22',
  text: 'Oi! Bom dia 😊'
}, {
  from: 'ai',
  author: 'Agente Conduzza',
  time: '14:22',
  status: 'read',
  text: 'Bom dia, Mariana! Aqui é o atendimento da Clínica Vitta. Como posso ajudar?'
}, {
  from: 'in',
  time: '14:26',
  text: 'Consigo remarcar minha consulta de amanhã pra quinta?'
}, {
  from: 'ai',
  author: 'Agente Conduzza',
  time: '14:27',
  status: 'read',
  text: 'Claro. Na quinta-feira (24/09) a Dra. Helena tem 10:30 e 15:00. Qual horário prefere?'
}, {
  from: 'in',
  time: '14:28',
  text: 'Pode ser 10:30. Segue o pedido de exame que o convênio pediu.',
  attachment: {
    name: 'pedido-exame.pdf',
    icon: 'file-text'
  }
}, {
  from: 'note',
  time: '14:28',
  text: 'Agente transferiu: paciente anexou documento — revisar antes de confirmar.'
}, {
  from: 'out',
  author: 'Rafaela',
  time: '14:30',
  status: 'read',
  text: 'Oi Mariana! Recebi o pedido. Remarquei para quinta, 24/09, às 10:30 com a Dra. Helena.'
}, {
  from: 'out',
  author: 'Rafaela',
  time: '14:30',
  status: 'sent',
  text: 'Chegue 15 minutos antes e traga documento com foto e a carteirinha do convênio.'
}];
const LEAD_STAGES = [{
  id: 'novo',
  label: 'Novo contato',
  tone: 'var(--cz-ink-400)'
}, {
  id: 'qualificando',
  label: 'Qualificando',
  tone: 'var(--cz-info-500)'
}, {
  id: 'orcamento',
  label: 'Orçamento enviado',
  tone: 'var(--cz-warning-500)'
}, {
  id: 'agendando',
  label: 'Agendando',
  tone: 'var(--cz-lime-500)'
}, {
  id: 'perdido',
  label: 'Perdido',
  tone: 'var(--cz-danger-500)'
}];
const LEADS = [{
  id: 'l1',
  stage: 'novo',
  name: 'Tatiane Moraes',
  phone: '(21) 98130-7755',
  meta: 'Interesse: Harmonização facial',
  tags: [TAGS.meta],
  owner: 'Rafaela',
  value: 'R$ 1.200',
  waiting: '2h'
}, {
  id: 'l2',
  stage: 'novo',
  name: 'Juliana Reis',
  phone: '(11) 99845-2210',
  meta: 'Veio do anúncio "Check-up 2026"',
  tags: [TAGS.meta],
  waiting: '5h'
}, {
  id: 'l3',
  stage: 'qualificando',
  name: 'Marcos Antunes',
  phone: '(11) 98221-9034',
  meta: 'Quer saber se atende Bradesco Saúde',
  tags: [TAGS.convenio],
  owner: 'Diego',
  waiting: '1d'
}, {
  id: 'l4',
  stage: 'qualificando',
  name: 'Letícia Barros',
  phone: '(11) 99310-7788',
  meta: 'Indicação da paciente Camila Fontes',
  tags: [TAGS.indicacao],
  owner: 'Rafaela',
  waiting: '1d 3h'
}, {
  id: 'l5',
  stage: 'orcamento',
  name: 'Bruno Tavares',
  phone: '(11) 99714-2280',
  meta: 'Sem resposta há 3 dias',
  urgent: true,
  owner: 'Rafaela',
  value: 'R$ 2.800',
  waiting: '3d'
}, {
  id: 'l6',
  stage: 'orcamento',
  name: 'Aline Castro',
  phone: '(11) 98004-1155',
  meta: 'Pediu parcelamento em 6x',
  owner: 'Diego',
  value: 'R$ 3.400',
  waiting: '2d'
}, {
  id: 'l7',
  stage: 'agendando',
  name: 'Felipe Dourado',
  phone: '(11) 97788-6621',
  meta: 'Escolhendo entre quinta e sexta',
  tags: [TAGS.primeira],
  owner: 'Rafaela',
  value: 'R$ 890',
  waiting: '4h'
}, {
  id: 'l8',
  stage: 'agendando',
  name: 'Priscila Nunes',
  phone: '(11) 99120-4477',
  meta: 'Aguardando autorização do convênio',
  tags: [TAGS.convenio],
  owner: 'Diego',
  value: 'R$ 640',
  waiting: '6h'
}, {
  id: 'l9',
  stage: 'perdido',
  name: 'Henrique Salles',
  phone: '(11) 98890-3312',
  meta: 'Achou o valor alto — reativar em 60 dias',
  waiting: '12d'
}];
const PROFISSIONAIS = [{
  id: 'p1',
  nome: 'Dra. Helena Reis',
  esp: 'Dermatologia',
  sala: 'Sala 2'
}, {
  id: 'p2',
  nome: 'Dr. Caio Prado',
  esp: 'Cardiologia',
  sala: 'Sala 4'
}, {
  id: 'p3',
  nome: 'Dra. Lívia Monteiro',
  esp: 'Ginecologia',
  sala: 'Sala 1'
}];
const AGENDA = {
  p1: [{
    start: '08:00',
    end: '08:30',
    patient: 'Mariana Alves',
    procedure: 'Retorno',
    status: 'confirmado'
  }, {
    start: '08:30',
    end: '09:00',
    patient: 'Paulo Nogueira',
    procedure: 'Primeira consulta',
    status: 'confirmado'
  }, {
    start: '09:00',
    end: '09:15',
    patient: 'Encaixe — Lia Rocha',
    status: 'encaixe',
    compact: true
  }, {
    start: '09:30',
    end: '10:00',
    patient: 'Camila Fontes',
    procedure: 'Avaliação',
    status: 'aguardando'
  }, {
    start: '10:30',
    end: '11:00',
    patient: 'Eduardo Prado',
    procedure: 'Retorno',
    status: 'confirmado'
  }, {
    start: '11:00',
    end: '12:00',
    patient: 'Almoço',
    status: 'bloqueio',
    compact: true
  }],
  p2: [{
    start: '08:00',
    end: '09:00',
    patient: 'Tatiane Moraes',
    procedure: 'Ecocardiograma',
    status: 'confirmado'
  }, {
    start: '09:00',
    end: '09:30',
    patient: 'Bruno Tavares',
    procedure: 'Retorno',
    status: 'cancelado'
  }, {
    start: '10:00',
    end: '10:30',
    patient: 'Marcos Antunes',
    procedure: 'Primeira consulta',
    status: 'aguardando'
  }, {
    start: '11:00',
    end: '11:30',
    patient: 'Aline Castro',
    procedure: 'MAPA 24h',
    status: 'confirmado'
  }],
  p3: [{
    start: '08:15',
    end: '08:45',
    patient: 'Renata Lopes',
    procedure: 'Preventivo',
    status: 'confirmado'
  }, {
    start: '08:45',
    end: '09:15',
    patient: 'Sofia Duarte',
    procedure: 'Primeira consulta',
    status: 'aguardando'
  }, {
    start: '09:30',
    end: '10:00',
    patient: 'Letícia Barros',
    procedure: 'Retorno',
    status: 'confirmado'
  }, {
    start: '10:30',
    end: '11:00',
    patient: 'Priscila Nunes',
    procedure: 'Ultrassom',
    status: 'confirmado'
  }]
};
const PACIENTES = [{
  id: 'pa1',
  nome: 'Mariana Alves',
  tel: '(11) 98812-4409',
  nasc: '14/03/1991',
  convenio: 'Amil',
  prof: 'Dra. Helena Reis',
  ultima: '12/09/2026',
  proxima: '24/09/2026',
  status: 'ativo'
}, {
  id: 'pa2',
  nome: 'Paulo Nogueira',
  tel: '(11) 99714-2280',
  nasc: '02/11/1978',
  convenio: 'Particular',
  prof: 'Dr. Caio Prado',
  ultima: '04/09/2026',
  proxima: '—',
  status: 'ativo'
}, {
  id: 'pa3',
  nome: 'Camila Fontes',
  tel: '(11) 97455-1120',
  nasc: '27/06/1985',
  convenio: 'Bradesco Saúde',
  prof: 'Dra. Helena Reis',
  ultima: '28/08/2026',
  proxima: '30/09/2026',
  status: 'ativo'
}, {
  id: 'pa4',
  nome: 'Eduardo Prado',
  tel: '(11) 98771-6603',
  nasc: '19/01/1966',
  convenio: 'Unimed',
  prof: 'Dr. Caio Prado',
  ultima: '15/08/2026',
  proxima: '—',
  status: 'inativo'
}, {
  id: 'pa5',
  nome: 'Renata Lopes',
  tel: '(11) 98120-3377',
  nasc: '08/09/1994',
  convenio: 'Particular',
  prof: 'Dra. Lívia Monteiro',
  ultima: '22/09/2026',
  proxima: '22/10/2026',
  status: 'ativo'
}, {
  id: 'pa6',
  nome: 'Sofia Duarte',
  tel: '(11) 99002-4418',
  nasc: '30/04/1999',
  convenio: 'SulAmérica',
  prof: 'Dra. Lívia Monteiro',
  ultima: '09/09/2026',
  proxima: '—',
  status: 'pendente'
}];
const CONFIRMACOES = [{
  id: 'cf1',
  hora: '08:00',
  paciente: 'Mariana Alves',
  prof: 'Dra. Helena Reis',
  proc: 'Retorno',
  canal: 'WhatsApp',
  status: 'confirmado',
  enviado: '09:02'
}, {
  id: 'cf2',
  hora: '08:30',
  paciente: 'Paulo Nogueira',
  prof: 'Dra. Helena Reis',
  proc: 'Primeira consulta',
  canal: 'WhatsApp',
  status: 'confirmado',
  enviado: '09:02'
}, {
  id: 'cf3',
  hora: '09:00',
  paciente: 'Marcos Antunes',
  prof: 'Dr. Caio Prado',
  proc: 'Primeira consulta',
  canal: 'WhatsApp',
  status: 'aguardando',
  enviado: '09:02'
}, {
  id: 'cf4',
  hora: '09:30',
  paciente: 'Camila Fontes',
  prof: 'Dra. Helena Reis',
  proc: 'Avaliação',
  canal: 'WhatsApp',
  status: 'aguardando',
  enviado: '09:02'
}, {
  id: 'cf5',
  hora: '10:00',
  paciente: 'Bruno Tavares',
  prof: 'Dr. Caio Prado',
  proc: 'Retorno',
  canal: 'WhatsApp',
  status: 'cancelado',
  enviado: '09:02'
}, {
  id: 'cf6',
  hora: '10:30',
  paciente: 'Eduardo Prado',
  prof: 'Dr. Caio Prado',
  proc: 'Retorno',
  canal: 'Ligação',
  status: 'confirmado',
  enviado: '09:14'
}, {
  id: 'cf7',
  hora: '11:00',
  paciente: 'Aline Castro',
  prof: 'Dr. Caio Prado',
  proc: 'MAPA 24h',
  canal: 'WhatsApp',
  status: 'confirmado',
  enviado: '09:02'
}, {
  id: 'cf8',
  hora: '11:30',
  paciente: 'Sofia Duarte',
  prof: 'Dra. Lívia Monteiro',
  proc: 'Primeira consulta',
  canal: 'WhatsApp',
  status: 'falhou',
  enviado: '09:02'
}];
const ESPERA = [{
  id: 'e1',
  paciente: 'Juliana Reis',
  tel: '(11) 99845-2210',
  prof: 'Dra. Helena Reis',
  pref: 'Manhã · seg a qua',
  desde: '18/09/2026',
  prio: 'alta'
}, {
  id: 'e2',
  paciente: 'Felipe Dourado',
  tel: '(11) 97788-6621',
  prof: 'Qualquer',
  pref: 'Tarde · qui ou sex',
  desde: '19/09/2026',
  prio: 'media'
}, {
  id: 'e3',
  paciente: 'Letícia Barros',
  tel: '(11) 99310-7788',
  prof: 'Dra. Lívia Monteiro',
  pref: 'Manhã · sábado',
  desde: '20/09/2026',
  prio: 'alta'
}, {
  id: 'e4',
  paciente: 'Marcos Antunes',
  tel: '(11) 98221-9034',
  prof: 'Dr. Caio Prado',
  pref: 'Qualquer horário',
  desde: '20/09/2026',
  prio: 'baixa'
}, {
  id: 'e5',
  paciente: 'Priscila Nunes',
  tel: '(11) 99120-4477',
  prof: 'Dra. Lívia Monteiro',
  pref: 'Tarde · seg a sex',
  desde: '21/09/2026',
  prio: 'media'
}];
const QUICK_REPLIES = ['Bom dia! 👋', 'Confirmar presença', 'Enviar endereço', 'Valores e convênios', 'Documentos necessários'];
Object.assign(window, {
  CLINIC,
  NAV,
  TAGS,
  CONVERSAS,
  THREAD,
  LEAD_STAGES,
  LEADS,
  PROFISSIONAIS,
  AGENDA,
  PACIENTES,
  CONFIRMACOES,
  ESPERA,
  QUICK_REPLIES
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/conduzza-chat/data.jsx", error: String((e && e.message) || e) }); }

// ui_kits/conduzza-chat/screens-admin.jsx
try { (() => {
const DSd = window.ConduzzaDesignSystem_cea3ac;
const {
  Card,
  Badge,
  Button,
  IconButton,
  Icon,
  Avatar,
  SegmentedControl,
  SearchField,
  Select,
  Input,
  Switch,
  Checkbox,
  DataTable,
  StatCard,
  EmptyState,
  PageHeader,
  Tabs,
  Banner,
  Tag,
  Dropdown
} = DSd;

/* ── Cadastro ───────────────────────────────────────────────────── */
const CAD_TABS = [{
  value: 'profissionais',
  label: 'Profissionais',
  count: 14
}, {
  value: 'procedimentos',
  label: 'Procedimentos',
  count: 62
}, {
  value: 'convenios',
  label: 'Planos de saúde',
  count: 9
}, {
  value: 'horarios',
  label: 'Horários'
}, {
  value: 'unidades',
  label: 'Unidades',
  count: 3
}];
const CAD_ROWS = {
  profissionais: {
    cols: [{
      key: 'nome',
      header: 'Profissional',
      strong: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avatar, {
        name: r.nome,
        size: "xs"
      }), r.nome)
    }, {
      key: 'esp',
      header: 'Especialidade'
    }, {
      key: 'crm',
      header: 'CRM',
      numeric: true,
      muted: true
    }, {
      key: 'unidade',
      header: 'Unidade',
      muted: true
    }, {
      key: 'dur',
      header: 'Duração padrão',
      numeric: true,
      align: 'right',
      muted: true
    }, {
      key: 'ativo',
      header: 'Status',
      render: r => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        dot: true,
        tone: r.ativo ? 'success' : 'neutral'
      }, r.ativo ? 'Ativo' : 'Inativo')
    }],
    rows: [{
      id: '1',
      nome: 'Dra. Helena Reis',
      esp: 'Dermatologia',
      crm: 'CRM/SP 118.402',
      unidade: 'Centro',
      dur: '30 min',
      ativo: true
    }, {
      id: '2',
      nome: 'Dr. Caio Prado',
      esp: 'Cardiologia',
      crm: 'CRM/SP 96.771',
      unidade: 'Centro',
      dur: '40 min',
      ativo: true
    }, {
      id: '3',
      nome: 'Dra. Lívia Monteiro',
      esp: 'Ginecologia',
      crm: 'CRM/SP 132.559',
      unidade: 'Centro · Sul',
      dur: '30 min',
      ativo: true
    }, {
      id: '4',
      nome: 'Dr. Otávio Lins',
      esp: 'Ortopedia',
      crm: 'CRM/SP 104.318',
      unidade: 'Sul',
      dur: '30 min',
      ativo: false
    }]
  },
  procedimentos: {
    cols: [{
      key: 'nome',
      header: 'Procedimento',
      strong: true
    }, {
      key: 'esp',
      header: 'Especialidade',
      muted: true
    }, {
      key: 'dur',
      header: 'Duração',
      numeric: true,
      align: 'right',
      muted: true
    }, {
      key: 'valor',
      header: 'Particular',
      numeric: true,
      align: 'right'
    }, {
      key: 'conv',
      header: 'Convênios',
      muted: true
    }],
    rows: [{
      id: '1',
      nome: 'Consulta dermatológica',
      esp: 'Dermatologia',
      dur: '30 min',
      valor: 'R$ 380,00',
      conv: 'Amil, Bradesco, SulAmérica'
    }, {
      id: '2',
      nome: 'Harmonização facial',
      esp: 'Dermatologia',
      dur: '60 min',
      valor: 'R$ 1.200,00',
      conv: 'Particular'
    }, {
      id: '3',
      nome: 'Ecocardiograma',
      esp: 'Cardiologia',
      dur: '45 min',
      valor: 'R$ 540,00',
      conv: 'Amil, Unimed'
    }, {
      id: '4',
      nome: 'MAPA 24h',
      esp: 'Cardiologia',
      dur: '20 min',
      valor: 'R$ 320,00',
      conv: 'Unimed'
    }, {
      id: '5',
      nome: 'Preventivo',
      esp: 'Ginecologia',
      dur: '30 min',
      valor: 'R$ 290,00',
      conv: 'Todos'
    }]
  },
  convenios: {
    cols: [{
      key: 'nome',
      header: 'Plano',
      strong: true
    }, {
      key: 'reg',
      header: 'Registro ANS',
      numeric: true,
      muted: true
    }, {
      key: 'prazo',
      header: 'Prazo de repasse',
      numeric: true,
      align: 'right',
      muted: true
    }, {
      key: 'ativo',
      header: 'Status',
      render: r => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        dot: true,
        tone: r.ativo ? 'success' : 'warning'
      }, r.ativo ? 'Ativo' : 'Em negociação')
    }],
    rows: [{
      id: '1',
      nome: 'Amil',
      reg: '326.305',
      prazo: '45 dias',
      ativo: true
    }, {
      id: '2',
      nome: 'Bradesco Saúde',
      reg: '005.711',
      prazo: '60 dias',
      ativo: true
    }, {
      id: '3',
      nome: 'SulAmérica',
      reg: '006.246',
      prazo: '30 dias',
      ativo: true
    }, {
      id: '4',
      nome: 'Unimed',
      reg: '339.679',
      prazo: '45 dias',
      ativo: true
    }, {
      id: '5',
      nome: 'Porto Seguro',
      reg: '416.746',
      prazo: '—',
      ativo: false
    }]
  },
  unidades: {
    cols: [{
      key: 'nome',
      header: 'Unidade',
      strong: true
    }, {
      key: 'end',
      header: 'Endereço',
      muted: true,
      wrap: true
    }, {
      key: 'salas',
      header: 'Salas',
      numeric: true,
      align: 'right'
    }, {
      key: 'tel',
      header: 'WhatsApp',
      numeric: true,
      muted: true
    }],
    rows: [{
      id: '1',
      nome: 'Unidade Centro',
      end: 'R. Augusta, 1.402 — Consolação, São Paulo',
      salas: '6',
      tel: '(11) 3255-8800'
    }, {
      id: '2',
      nome: 'Unidade Sul',
      end: 'Av. Santo Amaro, 3.120 — Brooklin, São Paulo',
      salas: '4',
      tel: '(11) 3255-8801'
    }, {
      id: '3',
      nome: 'Unidade Alphaville',
      end: 'Al. Rio Negro, 585 — Barueri',
      salas: '3',
      tel: '(11) 3255-8802'
    }]
  }
};
function ScreenCadastro() {
  const [tab, setTab] = React.useState('profissionais');
  const cfg = CAD_ROWS[tab];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: "ADMINISTRA\xC7\xC3O",
    title: "Cadastro",
    description: "A base que alimenta a agenda, o agente de IA e as automa\xE7\xF5es.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SearchField, {
      size: "sm",
      placeholder: "Buscar no cadastro",
      style: {
        width: 220
      }
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus"
    }, "Novo registro"))
  }), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: CAD_TABS
  }), tab === 'horarios' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Hor\xE1rio de funcionamento \xB7 Unidade Centro",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, [['Segunda', '07:00', '19:00', true], ['Terça', '07:00', '19:00', true], ['Quarta', '07:00', '19:00', true], ['Quinta', '07:00', '19:00', true], ['Sexta', '07:00', '18:00', true], ['Sábado', '08:00', '12:00', true], ['Domingo', '—', '—', false]].map(([d, a, b, on]) => /*#__PURE__*/React.createElement("div", {
    key: d,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Switch, {
    size: "sm",
    checked: on,
    onChange: () => {}
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 78,
      fontSize: 13,
      color: 'var(--text-body)'
    }
  }, d), /*#__PURE__*/React.createElement(Input, {
    size: "sm",
    defaultValue: a,
    block: false,
    wrapStyle: {
      width: 84
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, "\u2014"), /*#__PURE__*/React.createElement(Input, {
    size: "sm",
    defaultValue: b,
    block: false,
    wrapStyle: {
      width: 84
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Intervalos e bloqueios",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, [['Almoço', 'Seg a sex · 12:00 – 13:00'], ['Reunião clínica', 'Quarta · 18:00 – 19:00'], ['Feriado — 12/10', 'Dia inteiro']].map(([t, s]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-sunken)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "ban",
    size: 15,
    color: "var(--cz-ink-400)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-strong)'
    }
  }, t), /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 11,
      color: 'var(--text-muted)'
    }
  }, s)), /*#__PURE__*/React.createElement(IconButton, {
    icon: "pencil",
    label: "Editar",
    size: "sm"
  }))))), /*#__PURE__*/React.createElement(Card, {
    header: "Regras de encaixe",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: true,
    label: "Permitir encaixe entre consultas",
    description: "M\xE1ximo de 2 por per\xEDodo",
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Switch, {
    checked: true,
    label: "Oferecer vaga \xE0 lista de espera",
    description: "Autom\xE1tico em at\xE9 5 minutos ap\xF3s o cancelamento",
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Switch, {
    label: "Permitir agendamento no mesmo dia pela IA",
    onChange: () => {}
  }))))) : /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    style: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: cfg.rows,
    columns: [...cfg.cols, {
      key: 'acoes',
      header: '',
      align: 'right',
      render: () => /*#__PURE__*/React.createElement(Dropdown, {
        align: "right",
        trigger: /*#__PURE__*/React.createElement(IconButton, {
          icon: "ellipsis",
          label: "A\xE7\xF5es",
          size: "sm"
        }),
        items: [{
          label: 'Editar',
          icon: 'pencil'
        }, {
          label: 'Duplicar',
          icon: 'copy'
        }, {
          divider: true
        }, {
          label: 'Excluir',
          icon: 'trash-2',
          danger: true
        }]
      })
    }]
  })));
}

/* ── Configurações ──────────────────────────────────────────────── */
const CFG_TABS = [{
  value: 'usuarios',
  label: 'Usuários',
  count: 8
}, {
  value: 'permissoes',
  label: 'Permissões'
}, {
  value: 'whatsapp',
  label: 'WhatsApp',
  count: 3
}, {
  value: 'jornada',
  label: 'Etapas da jornada'
}, {
  value: 'etiquetas',
  label: 'Etiquetas',
  count: 12
}, {
  value: 'meta',
  label: 'Anúncios Meta'
}];
function ScreenConfig() {
  const [tab, setTab] = React.useState('whatsapp');
  return /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      padding: 'var(--page-gutter)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      height: '100%',
      minHeight: 0,
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: "ADMINISTRA\xC7\xC3O",
    title: "Configura\xE7\xF5es",
    description: "Acessos, conex\xF5es e a estrutura que o time usa todos os dias."
  }), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: CFG_TABS
  }), tab === 'whatsapp' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Banner, {
    tone: "warning",
    title: "A sess\xE3o da Unidade Sul expira em 2 dias",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost"
    }, "Reconectar agora")
  }, "Reconecte pelo QR Code para n\xE3o interromper os disparos."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
      gap: 12
    }
  }, [['Unidade Centro', '(11) 3255-8800', 'conectado', '2.140 mensagens hoje'], ['Unidade Sul', '(11) 3255-8801', 'expirando', '812 mensagens hoje'], ['Unidade Alphaville', '(11) 3255-8802', 'conectado', '468 mensagens hoje']].map(([n, t, st, m]) => /*#__PURE__*/React.createElement(Card, {
    key: n,
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 32,
      height: 32,
      borderRadius: 'var(--radius-sm)',
      background: 'rgba(37,211,102,.12)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "message-circle",
    size: 16,
    color: "var(--cz-whatsapp)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-strong)'
    }
  }, n), /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 11.5,
      color: 'var(--text-muted)'
    }
  }, t))), /*#__PURE__*/React.createElement(Badge, {
    dot: true,
    size: "sm",
    tone: st === 'conectado' ? 'success' : 'warning'
  }, st === 'conectado' ? 'Conectado' : 'Expirando'), /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 11.5,
      color: 'var(--text-faint)',
      marginTop: 10
    }
  }, m), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    icon: "qr-code",
    block: true
  }, "Reconectar")))))), tab === 'usuarios' && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: [{
      id: '1',
      nome: 'Rafaela Souza',
      email: 'rafaela@clinicavitta.com.br',
      papel: 'Atendimento',
      unid: 'Centro',
      ult: 'agora'
    }, {
      id: '2',
      nome: 'Diego Ramires',
      email: 'diego@clinicavitta.com.br',
      papel: 'Atendimento',
      unid: 'Centro · Sul',
      ult: 'há 12 min'
    }, {
      id: '3',
      nome: 'Patrícia Lemos',
      email: 'patricia@clinicavitta.com.br',
      papel: 'Gestor',
      unid: 'Todas',
      ult: 'há 2 h'
    }, {
      id: '4',
      nome: 'Marcelo Vieira',
      email: 'marcelo@clinicavitta.com.br',
      papel: 'Administrador',
      unid: 'Todas',
      ult: 'ontem'
    }],
    columns: [{
      key: 'nome',
      header: 'Usuário',
      strong: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avatar, {
        name: r.nome,
        size: "xs"
      }), r.nome)
    }, {
      key: 'email',
      header: 'E-mail',
      muted: true
    }, {
      key: 'papel',
      header: 'Papel',
      render: r => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        tone: r.papel === 'Administrador' ? 'inverse' : r.papel === 'Gestor' ? 'lime' : 'neutral'
      }, r.papel)
    }, {
      key: 'unid',
      header: 'Unidades',
      muted: true
    }, {
      key: 'ult',
      header: 'Último acesso',
      align: 'right',
      muted: true
    }]
  })), tab === 'permissoes' && /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: [{
      id: '1',
      rec: 'Ver todas as conversas',
      at: false,
      ge: true,
      ad: true
    }, {
      id: '2',
      rec: 'Transferir atendimento',
      at: true,
      ge: true,
      ad: true
    }, {
      id: '3',
      rec: 'Editar agenda de outros profissionais',
      at: false,
      ge: true,
      ad: true
    }, {
      id: '4',
      rec: 'Publicar alterações no agente de IA',
      at: false,
      ge: false,
      ad: true
    }, {
      id: '5',
      rec: 'Ver Resultados financeiros',
      at: false,
      ge: true,
      ad: true
    }, {
      id: '6',
      rec: 'Gerenciar usuários e conexões',
      at: false,
      ge: false,
      ad: true
    }],
    columns: [{
      key: 'rec',
      header: 'Permissão',
      strong: true,
      wrap: true
    }, {
      key: 'at',
      header: 'Atendimento',
      align: 'center',
      render: r => /*#__PURE__*/React.createElement(Checkbox, {
        checked: r.at,
        onChange: () => {}
      })
    }, {
      key: 'ge',
      header: 'Gestor',
      align: 'center',
      render: r => /*#__PURE__*/React.createElement(Checkbox, {
        checked: r.ge,
        onChange: () => {}
      })
    }, {
      key: 'ad',
      header: 'Administrador',
      align: 'center',
      render: r => /*#__PURE__*/React.createElement(Checkbox, {
        checked: r.ad,
        onChange: () => {}
      })
    }]
  })), tab === 'jornada' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Etapas do atendimento",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      icon: "plus"
    }, "Etapa"),
    padding: 14
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, ['Novo', 'Em atendimento', 'Agente de IA', 'Agendado', 'Resolvido'].map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 11px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-sunken)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "grip-vertical",
    size: 14,
    color: "var(--cz-ink-300)"
  }), /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 11,
      color: 'var(--text-faint)'
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      color: 'var(--text-body)'
    }
  }, s), /*#__PURE__*/React.createElement(IconButton, {
    icon: "pencil",
    label: "Renomear",
    size: "sm"
  }))))), /*#__PURE__*/React.createElement(Card, {
    header: "Etapas do funil de leads",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      icon: "plus"
    }, "Etapa"),
    padding: 14
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, LEAD_STAGES.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 11px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-sunken)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "grip-vertical",
    size: 14,
    color: "var(--cz-ink-300)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 2,
      background: s.tone
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      color: 'var(--text-body)'
    }
  }, s.label), /*#__PURE__*/React.createElement(IconButton, {
    icon: "pencil",
    label: "Renomear",
    size: "sm"
  })))))), tab === 'etiquetas' && /*#__PURE__*/React.createElement(Card, {
    header: "Etiquetas da cl\xEDnica",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      icon: "plus"
    }, "Nova etiqueta"),
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, [...Object.values(TAGS), {
    label: 'Pós-operatório',
    color: '#4785b5'
  }, {
    label: 'Retorno',
    color: '#2f9e5b'
  }, {
    label: 'Exame pendente',
    color: '#d9962a'
  }, {
    label: 'VIP',
    color: '#051813'
  }, {
    label: 'Reativação',
    color: '#7fb320'
  }, {
    label: 'Sem contato',
    color: '#8b9a92'
  }].map(t => /*#__PURE__*/React.createElement(Tag, {
    key: t.label,
    color: t.color,
    onRemove: () => {}
  }, t.label)))), tab === 'meta' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Conta de an\xFAncios",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 34,
      height: 34,
      borderRadius: 'var(--radius-sm)',
      background: 'rgba(8,102,255,.10)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "at-sign",
    size: 17,
    color: "var(--cz-meta)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-strong)'
    }
  }, "Cl\xEDnica Vitta \u2014 Ads"), /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 11.5,
      color: 'var(--text-muted)'
    }
  }, "act_408177291")), /*#__PURE__*/React.createElement(Badge, {
    tone: "success",
    dot: true,
    size: "sm"
  }, "Conectada")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Switch, {
    checked: true,
    label: "Importar leads do Facebook Lead Ads",
    description: "Novos leads entram direto no Kanban",
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Switch, {
    checked: true,
    label: "Traquear origem da conversa",
    description: "Grava campanha, conjunto e an\xFAncio no contato",
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Switch, {
    checked: true,
    label: "Enviar convers\xF5es para o Meta",
    description: "Agendamento e comparecimento via Conversions API",
    onChange: () => {}
  }))), /*#__PURE__*/React.createElement(Card, {
    header: "Etiqueta autom\xE1tica por campanha",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, [['Check-up 2026 — Cardiologia', 'Meta Ads'], ['Harmonização facial — Setembro', 'Meta Ads'], ['Dermatologia — Remarketing', 'Reativação']].map(([c, t]) => /*#__PURE__*/React.createElement("div", {
    key: c,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 11px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-sunken)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 12.5,
      color: 'var(--text-body)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, c), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 13,
    color: "var(--cz-ink-300)"
  }), /*#__PURE__*/React.createElement(Tag, {
    color: t === 'Meta Ads' ? '#0866ff' : '#7fb320',
    size: "sm"
  }, t)))))));
}
Object.assign(window, {
  ScreenCadastro,
  ScreenConfig
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/conduzza-chat/screens-admin.jsx", error: String((e && e.message) || e) }); }

// ui_kits/conduzza-chat/screens-agenda.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const DSb = window.ConduzzaDesignSystem_cea3ac;
const {
  Card,
  Badge,
  Button,
  IconButton,
  Icon,
  Avatar,
  SegmentedControl,
  SearchField,
  Select,
  Input,
  DataTable,
  ProgressBar,
  StatCard,
  EmptyState,
  PageHeader,
  AppointmentCard,
  Dropdown,
  Banner,
  Tag
} = DSb;
const HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00'];
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/* ── Agenda ─────────────────────────────────────────────────────── */
function ScreenAgenda() {
  const [range, setRange] = React.useState('dia');
  const top = t => (toMin(t) - 480) / 60 * 64;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: "TER\xC7A, 22 DE SETEMBRO DE 2026",
    title: "Agenda",
    description: "Todos os profissionais da Unidade Centro.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SegmentedControl, {
      value: range,
      onChange: setRange,
      options: [{
        value: 'dia',
        label: 'Dia'
      }, {
        value: 'semana',
        label: 'Semana'
      }, {
        value: 'mes',
        label: 'Mês'
      }]
    }), /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      options: ['Todas as unidades', 'Unidade Centro', 'Unidade Sul'],
      block: false,
      wrapStyle: {
        width: 180
      }
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus"
    }, "Nova consulta"))
  }), /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: `62px repeat(${PROFISSIONAIS.length},minmax(0,1fr))`,
      borderBottom: '1px solid var(--border-subtle)',
      background: 'var(--cz-paper-050)'
    }
  }, /*#__PURE__*/React.createElement("div", null), PROFISSIONAIS.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      padding: '10px 12px',
      borderLeft: '1px solid var(--border-hairline)',
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: p.nome,
    size: "sm"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-strong)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, p.nome), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: 'var(--text-muted)'
    }
  }, p.esp, " \xB7 ", p.sala))))), /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: `62px repeat(${PROFISSIONAIS.length},minmax(0,1fr))`,
      position: 'relative',
      minHeight: HOURS.length * 64
    }
  }, /*#__PURE__*/React.createElement("div", null, HOURS.map(h => /*#__PURE__*/React.createElement("div", {
    key: h,
    className: "cz-num",
    style: {
      height: 64,
      padding: '4px 10px',
      fontSize: 10.5,
      color: 'var(--text-faint)',
      textAlign: 'right',
      borderTop: '1px solid var(--border-hairline)'
    }
  }, h))), PROFISSIONAIS.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      position: 'relative',
      borderLeft: '1px solid var(--border-hairline)'
    }
  }, HOURS.map(h => /*#__PURE__*/React.createElement("div", {
    key: h,
    style: {
      height: 64,
      borderTop: '1px solid var(--border-hairline)'
    }
  })), (AGENDA[p.id] || []).map((a, i) => /*#__PURE__*/React.createElement(AppointmentCard, _extends({
    key: i
  }, a, {
    professional: p.sala,
    style: {
      position: 'absolute',
      left: 5,
      right: 5,
      top: top(a.start) + 2,
      height: (toMin(a.end) - toMin(a.start)) / 60 * 64 - 4,
      minHeight: 26
    }
  })))))))));
}

/* ── Pacientes ──────────────────────────────────────────────────── */
function ScreenPacientes() {
  const [sel, setSel] = React.useState([]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Pacientes",
    description: "Contatos que j\xE1 realizaram pelo menos uma consulta.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SearchField, {
      size: "sm",
      placeholder: "Buscar por nome, CPF ou telefone",
      style: {
        width: 260
      }
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "download"
    }, "Exportar"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "user-plus"
    }, "Novo paciente"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,minmax(0,1fr))',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Pacientes ativos",
    value: "1.248",
    icon: "users",
    delta: "+34",
    deltaDirection: "up"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Novos no m\xEAs",
    value: "86",
    icon: "user-plus"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Retorno em 90 dias",
    value: "41",
    unit: "%",
    icon: "repeat"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Sem contato h\xE1 6 meses",
    value: "212",
    icon: "user-x",
    footnote: "Eleg\xEDveis para reativa\xE7\xE3o"
  })), /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    style: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    selectable: true,
    selected: sel,
    onSelect: id => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]),
    rows: PACIENTES,
    columns: [{
      key: 'nome',
      header: 'Paciente',
      strong: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avatar, {
        name: r.nome,
        size: "xs"
      }), r.nome)
    }, {
      key: 'tel',
      header: 'WhatsApp',
      numeric: true,
      muted: true
    }, {
      key: 'nasc',
      header: 'Nascimento',
      numeric: true,
      muted: true
    }, {
      key: 'convenio',
      header: 'Convênio'
    }, {
      key: 'prof',
      header: 'Profissional',
      muted: true
    }, {
      key: 'ultima',
      header: 'Última',
      numeric: true,
      align: 'right',
      muted: true
    }, {
      key: 'proxima',
      header: 'Próxima',
      numeric: true,
      align: 'right'
    }, {
      key: 'status',
      header: 'Status',
      render: r => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        dot: true,
        tone: r.status === 'ativo' ? 'success' : r.status === 'pendente' ? 'warning' : 'neutral'
      }, r.status)
    }]
  })));
}

/* ── Confirmações ───────────────────────────────────────────────── */
const CONF_TONE = {
  confirmado: 'success',
  aguardando: 'warning',
  cancelado: 'danger',
  falhou: 'danger'
};
function ScreenConfirmacoes() {
  const [f, setF] = React.useState('todos');
  const rows = f === 'todos' ? CONFIRMACOES : CONFIRMACOES.filter(r => r.status === f);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: "HOJE \xB7 22 DE SETEMBRO",
    title: "Confirma\xE7\xF5es",
    description: "Disparo autom\xE1tico \xE0s 09:00 do dia anterior. Respostas entram direto no Atendimento.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "rotate-cw"
    }, "Reenviar pendentes"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "send"
    }, "Disparar agora"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(5,minmax(0,1fr))',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Agendadas",
    value: "147",
    icon: "calendar-days"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Confirmadas",
    value: "128",
    accent: true,
    footnote: "87,2%"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Aguardando",
    value: "12",
    icon: "clock"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Canceladas",
    value: "6",
    icon: "calendar-x"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Falha no envio",
    value: "1",
    icon: "triangle-alert",
    footnote: "N\xFAmero inv\xE1lido"
  })), /*#__PURE__*/React.createElement(Banner, {
    tone: "lime",
    title: "19 pacientes ainda n\xE3o responderam",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost"
    }, "Enviar 2\xBA lembrete")
  }, "O segundo lembrete costuma converter 6 em cada 10 pendentes."), /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderBottom: '1px solid var(--border-hairline)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(SegmentedControl, {
    size: "sm",
    value: f,
    onChange: setF,
    options: [{
      value: 'todos',
      label: 'Todas',
      count: CONFIRMACOES.length
    }, {
      value: 'confirmado',
      label: 'Confirmadas'
    }, {
      value: 'aguardando',
      label: 'Aguardando'
    }, {
      value: 'cancelado',
      label: 'Canceladas'
    }, {
      value: 'falhou',
      label: 'Falhas'
    }]
  }), /*#__PURE__*/React.createElement(SearchField, {
    size: "sm",
    placeholder: "Buscar paciente",
    style: {
      width: 220,
      marginLeft: 'auto'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: rows,
    empty: "Nenhuma confirma\xE7\xE3o neste filtro.",
    columns: [{
      key: 'hora',
      header: 'Horário',
      numeric: true,
      strong: true
    }, {
      key: 'paciente',
      header: 'Paciente',
      strong: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avatar, {
        name: r.paciente,
        size: "xs"
      }), r.paciente)
    }, {
      key: 'prof',
      header: 'Profissional',
      muted: true
    }, {
      key: 'proc',
      header: 'Procedimento',
      muted: true
    }, {
      key: 'canal',
      header: 'Canal',
      render: r => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        tone: r.canal === 'WhatsApp' ? 'success' : 'neutral'
      }, r.canal)
    }, {
      key: 'enviado',
      header: 'Enviado',
      numeric: true,
      muted: true
    }, {
      key: 'status',
      header: 'Status',
      render: r => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        dot: true,
        tone: CONF_TONE[r.status]
      }, r.status)
    }, {
      key: 'acoes',
      header: '',
      align: 'right',
      render: () => /*#__PURE__*/React.createElement(Dropdown, {
        align: "right",
        trigger: /*#__PURE__*/React.createElement(IconButton, {
          icon: "ellipsis",
          label: "A\xE7\xF5es",
          size: "sm"
        }),
        items: [{
          label: 'Abrir conversa',
          icon: 'messages-square'
        }, {
          label: 'Reenviar lembrete',
          icon: 'rotate-cw'
        }, {
          label: 'Confirmar manualmente',
          icon: 'check'
        }, {
          divider: true
        }, {
          label: 'Cancelar consulta',
          icon: 'x',
          danger: true
        }]
      })
    }]
  }))));
}

/* ── Lista de espera ────────────────────────────────────────────── */
const PRIO = {
  alta: ['danger', 'Alta'],
  media: ['warning', 'Média'],
  baixa: ['neutral', 'Baixa']
};
function ScreenEspera() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Lista de espera",
    description: "Pacientes sem hor\xE1rio adequado. Quando um cancelamento acontece, a automa\xE7\xE3o oferece a vaga na ordem de prioridade.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "settings-2"
    }, "Regras de encaixe"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus"
    }, "Adicionar paciente"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)',
      gap: 16,
      flex: 1,
      minHeight: 0,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: ESPERA,
    columns: [{
      key: 'paciente',
      header: 'Paciente',
      strong: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avatar, {
        name: r.paciente,
        size: "xs"
      }), r.paciente)
    }, {
      key: 'tel',
      header: 'WhatsApp',
      numeric: true,
      muted: true
    }, {
      key: 'prof',
      header: 'Profissional',
      muted: true
    }, {
      key: 'pref',
      header: 'Preferência',
      muted: true
    }, {
      key: 'desde',
      header: 'Na lista desde',
      numeric: true,
      align: 'right',
      muted: true
    }, {
      key: 'prio',
      header: 'Prioridade',
      render: r => /*#__PURE__*/React.createElement(Badge, {
        size: "sm",
        dot: true,
        tone: PRIO[r.prio][0]
      }, PRIO[r.prio][1])
    }, {
      key: 'acao',
      header: '',
      align: 'right',
      render: () => /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "soft",
        icon: "zap"
      }, "Oferecer vaga")
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Vagas abertas hoje",
    padding: 14
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, [['09:00', 'Dr. Caio Prado', 'Cancelamento'], ['14:30', 'Dra. Helena Reis', 'Falta confirmada']].map(([h, p, m]) => /*#__PURE__*/React.createElement("div", {
    key: h,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: 10,
      borderRadius: 'var(--radius-sm)',
      background: 'var(--cz-lime-050)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--cz-lime-800)'
    }
  }, h), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 12.5,
      color: 'var(--text-body)'
    }
  }, p, /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-muted)'
    }
  }, m)), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "primary"
  }, "Preencher"))))), /*#__PURE__*/React.createElement(Card, {
    header: "Desempenho da lista",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Vagas preenchidas no m\xEAs",
    caption: "24 / 31",
    value: 24,
    max: 31
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Aceite na 1\xAA oferta",
    caption: "68%",
    value: 68,
    tone: "success"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Tempo m\xE9dio at\xE9 o encaixe",
    caption: "2h 40",
    value: 40,
    tone: "warning"
  }))))));
}
Object.assign(window, {
  ScreenAgenda,
  ScreenPacientes,
  ScreenConfirmacoes,
  ScreenEspera
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/conduzza-chat/screens-agenda.jsx", error: String((e && e.message) || e) }); }

// ui_kits/conduzza-chat/screens-inteligencia.jsx
try { (() => {
const DSc = window.ConduzzaDesignSystem_cea3ac;
const {
  Card,
  Badge,
  Button,
  IconButton,
  Icon,
  Avatar,
  SegmentedControl,
  SearchField,
  Select,
  Input,
  Textarea,
  Switch,
  Checkbox,
  DataTable,
  ProgressBar,
  StatCard,
  BarChart,
  DonutChart,
  EmptyState,
  PageHeader,
  Tabs,
  Banner,
  Tag,
  Dropdown
} = DSc;

/* ── Resultados ─────────────────────────────────────────────────── */
function ScreenResultados() {
  const [scope, setScope] = React.useState('geral');
  return /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      padding: 'var(--page-gutter)',
      display: 'grid',
      gap: 16,
      maxWidth: 'var(--content-max)',
      overflowY: 'auto',
      alignContent: 'start'
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: "1 \u2013 22 DE SETEMBRO DE 2026",
    title: "Resultados",
    description: "Marketing, comercial, follow-up, confirma\xE7\xE3o e agente de IA em um s\xF3 lugar.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      options: ['Este mês', 'Últimos 30 dias', 'Últimos 90 dias'],
      block: false,
      wrapStyle: {
        width: 160
      }
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "download"
    }, "Exportar PDF"))
  }), /*#__PURE__*/React.createElement(SegmentedControl, {
    value: scope,
    onChange: setScope,
    options: [{
      value: 'geral',
      label: 'Visão geral'
    }, {
      value: 'marketing',
      label: 'Marketing'
    }, {
      value: 'comercial',
      label: 'Comercial'
    }, {
      value: 'ia',
      label: 'Agente de IA'
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(5,minmax(0,1fr))',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Leads recebidos",
    value: "486",
    delta: "+18,2%",
    deltaDirection: "up",
    icon: "user-plus"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Consultas agendadas",
    value: "312",
    delta: "+9,4%",
    deltaDirection: "up",
    icon: "calendar-check"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Taxa de convers\xE3o",
    value: "64,2",
    unit: "%",
    accent: true,
    footnote: "Meta: 60%"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Custo por lead",
    value: "R$ 18,40",
    delta: "-6,1%",
    deltaDirection: "down",
    icon: "wallet"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Faturamento estimado",
    value: "R$ 284k",
    delta: "+12,8%",
    deltaDirection: "up",
    icon: "trending-up"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Leads x consultas agendadas",
    actions: /*#__PURE__*/React.createElement(Badge, {
      tone: "lime",
      size: "sm"
    }, "Setembro"),
    padding: 16
  }, /*#__PURE__*/React.createElement(BarChart, {
    height: 168,
    data: [{
      label: '01',
      value: 14
    }, {
      label: '04',
      value: 22
    }, {
      label: '07',
      value: 19
    }, {
      label: '10',
      value: 28
    }, {
      label: '13',
      value: 24
    }, {
      label: '16',
      value: 31
    }, {
      label: '19',
      value: 27
    }, {
      label: '22',
      value: 34,
      highlight: true
    }]
  })), /*#__PURE__*/React.createElement(Card, {
    header: "Origem dos leads",
    padding: 16
  }, /*#__PURE__*/React.createElement(DonutChart, {
    size: 124,
    thickness: 16,
    centerValue: "486",
    centerLabel: "leads",
    segments: [{
      label: 'Meta Ads',
      value: 214,
      color: 'var(--cz-lime-400)'
    }, {
      label: 'Google',
      value: 128,
      color: 'var(--cz-ink-900)'
    }, {
      label: 'Indicação',
      value: 96,
      color: 'var(--cz-lime-700)'
    }, {
      label: 'Orgânico',
      value: 48,
      color: 'var(--cz-ink-300)'
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Funil comercial",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Leads",
    caption: "486",
    value: 486,
    max: 486,
    tone: "ink"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Qualificados",
    caption: "392",
    value: 392,
    max: 486
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Or\xE7amento enviado",
    caption: "341",
    value: 341,
    max: 486,
    tone: "warning"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Agendados",
    caption: "312",
    value: 312,
    max: 486,
    tone: "success"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Compareceram",
    caption: "284",
    value: 284,
    max: 486,
    tone: "success"
  }))), /*#__PURE__*/React.createElement(Card, {
    header: "Confirma\xE7\xE3o de consulta",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Taxa de confirma\xE7\xE3o",
    caption: "87,2%",
    value: 87
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Taxa de comparecimento",
    caption: "91,0%",
    value: 91,
    tone: "success"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Faltas (no-show)",
    caption: "9,0%",
    value: 9,
    tone: "danger"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Remarca\xE7\xF5es",
    caption: "6,4%",
    value: 6.4,
    tone: "warning"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      paddingTop: 12,
      borderTop: '1px solid var(--border-hairline)',
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, "A confirma\xE7\xE3o autom\xE1tica reduziu as faltas em ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--cz-lime-700)'
    }
  }, "38%"), " desde mar\xE7o.")), /*#__PURE__*/React.createElement(Card, {
    header: "Agente de IA",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Conversas resolvidas sem humano",
    caption: "64%",
    value: 64
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Transferidas para a equipe",
    caption: "31%",
    value: 31,
    tone: "warning"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Escalonadas por insatisfa\xE7\xE3o",
    caption: "5%",
    value: 5,
    tone: "danger"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cz-eyebrow"
  }, "1\xAA resposta"), /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 20,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, "8s")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cz-eyebrow"
  }, "Satisfa\xE7\xE3o"), /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 20,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, "4,7"))))), /*#__PURE__*/React.createElement(Card, {
    header: "Campanhas Meta Ads",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      iconRight: "arrow-up-right"
    }, "Abrir no Gerenciador"),
    padding: 0
  }, /*#__PURE__*/React.createElement(DataTable, {
    dense: true,
    rows: [{
      id: 'm1',
      camp: 'Check-up 2026 — Cardiologia',
      inv: 'R$ 3.420',
      leads: '186',
      cpl: 'R$ 18,39',
      agend: '112',
      conv: '60,2%'
    }, {
      id: 'm2',
      camp: 'Harmonização facial — Setembro',
      inv: 'R$ 2.880',
      leads: '142',
      cpl: 'R$ 20,28',
      agend: '78',
      conv: '54,9%'
    }, {
      id: 'm3',
      camp: 'Dermatologia — Remarketing',
      inv: 'R$ 1.260',
      leads: '98',
      cpl: 'R$ 12,86',
      agend: '71',
      conv: '72,4%'
    }, {
      id: 'm4',
      camp: 'Ginecologia — Prevenção',
      inv: 'R$ 1.380',
      leads: '60',
      cpl: 'R$ 23,00',
      agend: '51',
      conv: '85,0%'
    }],
    columns: [{
      key: 'camp',
      header: 'Campanha',
      strong: true
    }, {
      key: 'inv',
      header: 'Investimento',
      numeric: true,
      align: 'right'
    }, {
      key: 'leads',
      header: 'Leads',
      numeric: true,
      align: 'right'
    }, {
      key: 'cpl',
      header: 'Custo por lead',
      numeric: true,
      align: 'right',
      muted: true
    }, {
      key: 'agend',
      header: 'Agendados',
      numeric: true,
      align: 'right'
    }, {
      key: 'conv',
      header: 'Conversão',
      numeric: true,
      align: 'right',
      strong: true
    }]
  })));
}

/* ── Agente de IA ───────────────────────────────────────────────── */
function ScreenIA() {
  const [on, setOn] = React.useState(true);
  const [tab, setTab] = React.useState('comportamento');
  return /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      padding: 'var(--page-gutter)',
      display: 'grid',
      gap: 16,
      maxWidth: 1080,
      overflowY: 'auto',
      alignContent: 'start'
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: "INTELIG\xCANCIA",
    title: "Agente de IA",
    description: "O agente atende primeiro, qualifica, agenda e transfere para a equipe quando precisa.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "play"
    }, "Testar conversa"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check"
    }, "Publicar altera\xE7\xF5es"))
  }), /*#__PURE__*/React.createElement(Card, {
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 42,
      height: 42,
      borderRadius: 'var(--radius-md)',
      background: 'var(--cz-ink-900)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 20,
    color: "var(--cz-lime-400)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 200
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-strong)'
    }
  }, "Agente Conduzza \xB7 Cl\xEDnica Vitta"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--text-muted)'
    }
  }, "Ativo em 3 linhas de WhatsApp \xB7 \xFAltima publica\xE7\xE3o h\xE1 2 dias")), /*#__PURE__*/React.createElement(Badge, {
    tone: on ? 'success' : 'neutral',
    dot: true
  }, on ? 'Ativo' : 'Pausado'), /*#__PURE__*/React.createElement(Switch, {
    checked: on,
    onChange: setOn
  }))), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: [{
      value: 'comportamento',
      label: 'Comportamento'
    }, {
      value: 'conhecimento',
      label: 'Base de conhecimento',
      count: 24
    }, {
      value: 'transferencia',
      label: 'Regras de transferência'
    }, {
      value: 'historico',
      label: 'Conversas revisadas',
      count: 94
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Identidade e tom",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Nome exibido",
    defaultValue: "Atendimento Cl\xEDnica Vitta"
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Tom de voz",
    options: ['Cordial e objetivo', 'Formal', 'Próximo e informal']
  }), /*#__PURE__*/React.createElement(Textarea, {
    label: "Instru\xE7\xF5es do agente",
    rows: 5,
    counter: 2000,
    defaultValue: 'Você atende pacientes da Clínica Vitta pelo WhatsApp.\nSempre confirme nome completo e convênio antes de agendar.\nNunca dê orientação médica — ofereça agendamento.\nSe o paciente demonstrar urgência, transfira imediatamente.'
  }))), /*#__PURE__*/React.createElement(Card, {
    header: "O que o agente pode fazer",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, [['Consultar horários disponíveis', 'Lê a Agenda em tempo real', true], ['Agendar e remarcar consultas', 'Cria o registro e dispara a confirmação', true], ['Informar valores e convênios', 'Usa a tabela do Cadastro', true], ['Enviar documentos e endereço', 'Anexos da base de conhecimento', true], ['Cancelar consultas', 'Sempre transfere para a equipe', false]].map(([t, d, v]) => /*#__PURE__*/React.createElement(Switch, {
    key: t,
    checked: v,
    onChange: () => {},
    label: t,
    description: d
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Pr\xE9via da conversa",
    padding: 14,
    tone: "sunken"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: 'flex-start',
      maxWidth: '82%',
      padding: '9px 12px',
      borderRadius: 'var(--radius-bubble)',
      borderBottomLeftRadius: 6,
      background: 'var(--surface)',
      border: '1px solid var(--border-hairline)',
      fontSize: 13
    }
  }, "Oi, voc\xEAs atendem Unimed?"), /*#__PURE__*/React.createElement("div", {
    className: "cz-dark",
    style: {
      alignSelf: 'flex-end',
      maxWidth: '82%',
      padding: '9px 12px',
      borderRadius: 'var(--radius-bubble)',
      borderBottomRightRadius: 6,
      background: 'var(--cz-ink-900)',
      color: 'var(--cz-cream-050)',
      fontSize: 13
    }
  }, "Atendemos sim! Para Unimed temos Dermatologia e Cardiologia. Quer que eu veja os hor\xE1rios desta semana?"))), /*#__PURE__*/React.createElement(Card, {
    header: "Desempenho \xB7 30 dias",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Resolvidas sem humano",
    caption: "64%",
    value: 64
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Agendamentos feitos pela IA",
    caption: "188",
    value: 188,
    max: 312,
    tone: "success"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Escalonadas por insatisfa\xE7\xE3o",
    caption: "5%",
    value: 5,
    tone: "danger"
  }))), /*#__PURE__*/React.createElement(Banner, {
    tone: "lime",
    title: "Sugest\xE3o do agente"
  }, "3 perguntas recorrentes sem resposta na base: estacionamento, hor\xE1rio de s\xE1bado e reembolso."))));
}

/* ── Automações ─────────────────────────────────────────────────── */
const AUTOS = [{
  id: 'a1',
  nome: 'Confirmação de consulta',
  icon: 'calendar-check',
  on: true,
  desc: 'Dispara 24h antes do horário marcado, às 09:00.',
  stat: '128 envios hoje · 87,2% de confirmação'
}, {
  id: 'a2',
  nome: 'Pós-falta',
  icon: 'user-x',
  on: true,
  desc: 'Mensagem 2h após a falta, oferecendo remarcação.',
  stat: '14 envios na semana · 6 remarcações'
}, {
  id: 'a3',
  nome: 'Follow-up de orçamento',
  icon: 'repeat',
  on: true,
  desc: 'Sequência em D+1, D+3 e D+7 para orçamentos sem resposta.',
  stat: '62 leads em sequência · 21% de resposta'
}, {
  id: 'a4',
  nome: 'Lista de espera',
  icon: 'zap',
  on: false,
  desc: 'Oferece a vaga cancelada por ordem de prioridade.',
  stat: 'Pausada desde 12/09'
}];
function ScreenAutomacoes() {
  const [sel, setSel] = React.useState('a1');
  const [states, setStates] = React.useState(Object.fromEntries(AUTOS.map(a => [a.id, a.on])));
  const cur = AUTOS.find(a => a.id === sel);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Automa\xE7\xF5es",
    description: "Quatro fluxos pr\xE9-definidos. Ligue, ajuste o texto e o hor\xE1rio \u2014 o resto \xE9 da Conduzza.",
    actions: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "history"
    }, "Hist\xF3rico de envios")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)',
      gap: 16,
      flex: 1,
      minHeight: 0,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 10
    }
  }, AUTOS.map(a => /*#__PURE__*/React.createElement(Card, {
    key: a.id,
    interactive: true,
    padding: 14,
    onClick: () => setSel(a.id),
    style: {
      border: `1px solid ${a.id === sel ? 'var(--cz-lime-400)' : 'var(--border-hairline)'}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 11
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center',
      width: 34,
      height: 34,
      borderRadius: 'var(--radius-sm)',
      background: states[a.id] ? 'var(--cz-lime-050)' : 'var(--cz-ink-050)',
      flex: '0 0 auto'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: a.icon,
    size: 17,
    color: states[a.id] ? 'var(--cz-lime-700)' : 'var(--cz-ink-400)'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-strong)'
    }
  }, a.nome), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)',
      marginTop: 2
    }
  }, a.desc), /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 11,
      color: 'var(--text-faint)',
      marginTop: 6
    }
  }, a.stat)), /*#__PURE__*/React.createElement(Switch, {
    size: "sm",
    checked: states[a.id],
    onChange: v => setStates(s => ({
      ...s,
      [a.id]: v
    }))
  }))))), /*#__PURE__*/React.createElement(Card, {
    header: cur.nome,
    actions: /*#__PURE__*/React.createElement(Badge, {
      tone: states[cur.id] ? 'success' : 'neutral',
      dot: true,
      size: "sm"
    }, states[cur.id] ? 'Ativa' : 'Pausada'),
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "Quando disparar",
    options: ['24h antes', '48h antes', '3h antes']
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Hor\xE1rio do disparo",
    defaultValue: "09:00",
    suffix: "BRT"
  })), /*#__PURE__*/React.createElement(Textarea, {
    label: "Mensagem",
    rows: 5,
    counter: 320,
    defaultValue: 'Olá, {primeiro_nome}! 👋\nConfirmando sua consulta com {profissional} em {data} às {hora}, na {unidade}.\n\nResponda 1 para confirmar ou 2 para remarcar.',
    hint: "Vari\xE1veis dispon\xEDveis: {primeiro_nome}, {profissional}, {data}, {hora}, {unidade}, {convenio}"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cz-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Aplicar a"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    checked: true,
    label: "Todas as unidades",
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Checkbox, {
    checked: true,
    label: "Consultas particulares e por conv\xEAnio",
    onChange: () => {}
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Incluir procedimentos de retorno",
    onChange: () => {}
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      paddingTop: 4
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "Descartar"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "check"
  }, "Salvar automa\xE7\xE3o"))))));
}
Object.assign(window, {
  ScreenResultados,
  ScreenIA,
  ScreenAutomacoes
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/conduzza-chat/screens-inteligencia.jsx", error: String((e && e.message) || e) }); }

// ui_kits/conduzza-chat/screens-operacao.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const DS = window.ConduzzaDesignSystem_cea3ac;
const {
  StatCard,
  Card,
  Badge,
  Tag,
  Button,
  IconButton,
  Icon,
  Avatar,
  SegmentedControl,
  SearchField,
  Select,
  Dropdown,
  DataTable,
  ProgressBar,
  BarChart,
  DonutChart,
  EmptyState,
  ChatBubble,
  ConversationItem,
  Composer,
  KanbanCard,
  Banner,
  PageHeader,
  Tabs
} = DS;

/* ── Início ─────────────────────────────────────────────────────── */
function ScreenInicio({
  go
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      display: 'grid',
      gap: 16,
      maxWidth: 'var(--content-max)'
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    eyebrow: "TER\xC7A, 22 DE SETEMBRO",
    title: `Bom dia, ${CLINIC.user.split(' ')[0]}`,
    description: "19 confirma\xE7\xF5es ainda sem resposta e 12 conversas aguardando atendimento humano.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "download"
    }, "Exportar dia"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "send",
      onClick: () => go('confirmacoes')
    }, "Disparar lembretes"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,minmax(0,1fr))',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(StatCard, {
    label: "Consultas hoje",
    value: "147",
    icon: "calendar-days",
    footnote: "3 unidades"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Confirmadas",
    value: "128",
    accent: true,
    delta: "+12,4%",
    deltaDirection: "up",
    footnote: "87,2% do total"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Aguardando",
    value: "19",
    icon: "clock",
    footnote: "\xDAltimo disparo 09:02"
  }), /*#__PURE__*/React.createElement(StatCard, {
    label: "Resolvidas pela IA",
    value: "64",
    unit: "%",
    icon: "sparkles",
    delta: "+8,1%",
    deltaDirection: "up"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Banner, {
    tone: "warning",
    title: "1 n\xFAmero de WhatsApp precisa de aten\xE7\xE3o",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: () => go('config')
    }, "Ver conex\xF5es")
  }, "A linha da Unidade Sul est\xE1 com a sess\xE3o expirando em 2 dias."), /*#__PURE__*/React.createElement(Card, {
    header: "Conversas aguardando voc\xEA",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      iconRight: "arrow-right",
      onClick: () => go('atendimento')
    }, "Abrir atendimento"),
    padding: 0
  }, CONVERSAS.slice(0, 4).map(c => /*#__PURE__*/React.createElement(ConversationItem, _extends({
    key: c.id
  }, c, {
    onClick: () => go('atendimento')
  })))), /*#__PURE__*/React.createElement(Card, {
    header: "Consultas por dia \xB7 \xFAltimos 7 dias",
    padding: 16
  }, /*#__PURE__*/React.createElement(BarChart, {
    height: 140,
    data: [{
      label: 'Qua',
      value: 118
    }, {
      label: 'Qui',
      value: 132
    }, {
      label: 'Sex',
      value: 141
    }, {
      label: 'Sáb',
      value: 64
    }, {
      label: 'Seg',
      value: 136
    }, {
      label: 'Ter',
      value: 147,
      highlight: true
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    header: "Agenda de hoje",
    actions: /*#__PURE__*/React.createElement(IconButton, {
      icon: "arrow-up-right",
      label: "Abrir agenda",
      onClick: () => go('agenda')
    }),
    padding: 14
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 7
    }
  }, AGENDA.p1.slice(0, 4).map((a, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "cz-num",
    style: {
      fontSize: 11.5,
      color: 'var(--text-faint)',
      width: 38
    }
  }, a.start), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 13,
      color: 'var(--text-body)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, a.patient), /*#__PURE__*/React.createElement(Badge, {
    size: "sm",
    tone: a.status === 'confirmado' ? 'success' : a.status === 'encaixe' ? 'lime' : a.status === 'bloqueio' ? 'neutral' : 'warning',
    dot: true
  }, a.status))))), /*#__PURE__*/React.createElement(Card, {
    header: "Funil de leads",
    actions: /*#__PURE__*/React.createElement(IconButton, {
      icon: "arrow-up-right",
      label: "Abrir leads",
      onClick: () => go('leads')
    }),
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Novo contato",
    caption: "38",
    value: 38,
    max: 38,
    tone: "ink"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Qualificando",
    caption: "24",
    value: 24,
    max: 38
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Or\xE7amento enviado",
    caption: "15",
    value: 15,
    max: 38,
    tone: "warning"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    label: "Agendando",
    caption: "9",
    value: 9,
    max: 38,
    tone: "success"
  }))), /*#__PURE__*/React.createElement(Card, {
    tone: "inverse",
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 16,
    color: "var(--cz-lime-400)"
  }), /*#__PURE__*/React.createElement("span", {
    className: "cz-eyebrow",
    style: {
      color: 'rgba(251,252,232,.5)'
    }
  }, "Agente de IA")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      color: 'var(--cz-cream-050)',
      lineHeight: 1.5
    }
  }, "O agente respondeu 94 conversas hoje e transferiu 12 para a equipe. Tempo m\xE9dio de primeira resposta: ", /*#__PURE__*/React.createElement("span", {
    className: "cz-num"
  }, "8s"), "."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    iconRight: "arrow-right",
    onClick: () => go('ia')
  }, "Revisar agente"))))));
}

/* ── Atendimento ────────────────────────────────────────────────── */
function ScreenAtendimento() {
  const [sel, setSel] = React.useState('c1');
  const [filter, setFilter] = React.useState('todos');
  const [draft, setDraft] = React.useState('');
  const [msgs, setMsgs] = React.useState(THREAD);
  const conv = CONVERSAS.find(c => c.id === sel) || CONVERSAS[0];
  const list = filter === 'todos' ? CONVERSAS : filter === 'meus' ? CONVERSAS.filter(c => c.assignee === 'Rafaela') : CONVERSAS.filter(c => c.aiHandled);
  const send = () => {
    if (!draft.trim()) return;
    setMsgs(m => [...m, {
      from: 'out',
      author: 'Rafaela',
      time: '14:3' + m.length % 9,
      status: 'sent',
      text: draft
    }]);
    setDraft('');
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: '100%',
      minHeight: 0,
      minWidth: 1100,
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 'var(--inbox-list-w)',
      flex: '0 0 auto',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border-hairline)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      display: 'grid',
      gap: 9,
      borderBottom: '1px solid var(--border-hairline)'
    }
  }, /*#__PURE__*/React.createElement(SearchField, {
    placeholder: "Buscar conversa ou telefone"
  }), /*#__PURE__*/React.createElement(SegmentedControl, {
    block: true,
    size: "sm",
    value: filter,
    onChange: setFilter,
    options: [{
      value: 'todos',
      label: 'Todas',
      count: CONVERSAS.length
    }, {
      value: 'meus',
      label: 'Meus'
    }, {
      value: 'ia',
      label: 'IA'
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Dropdown, {
    trigger: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      icon: "filter",
      iconRight: "chevron-down"
    }, "Etiquetas"),
    items: Object.values(TAGS).map(t => ({
      label: t.label,
      checked: false
    }))
  }), /*#__PURE__*/React.createElement(Dropdown, {
    trigger: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      iconRight: "chevron-down"
    }, "Etapa"),
    items: [{
      label: 'Novo'
    }, {
      label: 'Em atendimento'
    }, {
      label: 'Agente de IA'
    }, {
      label: 'Resolvido'
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      flex: 1,
      overflowY: 'auto'
    }
  }, list.map(c => /*#__PURE__*/React.createElement(ConversationItem, _extends({
    key: c.id
  }, c, {
    active: c.id === sel,
    onClick: () => setSel(c.id)
  }))))), /*#__PURE__*/React.createElement("section", {
    style: {
      flex: 1,
      minWidth: 420,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--cz-paper-050)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      flex: '0 0 auto',
      display: 'flex',
      alignItems: 'center',
      gap: 11,
      padding: '10px 16px',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border-hairline)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: conv.name,
    size: "md"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-strong)'
    }
  }, conv.name), /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 11.5,
      color: 'var(--text-muted)'
    }
  }, conv.phone, " \xB7 WhatsApp")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "lime",
    icon: "sparkles",
    size: "sm"
  }, "IA pausada"), /*#__PURE__*/React.createElement(IconButton, {
    icon: "user-round-search",
    label: "Ver paciente",
    variant: "secondary"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "arrow-right-left",
    label: "Transferir",
    variant: "secondary"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "check-check",
    label: "Resolver",
    variant: "secondary"
  }), /*#__PURE__*/React.createElement(Dropdown, {
    align: "right",
    trigger: /*#__PURE__*/React.createElement(IconButton, {
      icon: "ellipsis",
      label: "Mais a\xE7\xF5es",
      variant: "secondary"
    }),
    items: [{
      label: 'Agendar consulta',
      icon: 'calendar-plus'
    }, {
      label: 'Adicionar etiqueta',
      icon: 'tag'
    }, {
      label: 'Exportar conversa',
      icon: 'download'
    }, {
      divider: true
    }, {
      label: 'Bloquear contato',
      icon: 'ban',
      danger: true
    }]
  }))), /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: 'center',
      fontSize: 11,
      color: 'var(--text-faint)',
      background: 'var(--surface)',
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      border: '1px solid var(--border-hairline)'
    }
  }, "Hoje"), msgs.map((m, i) => /*#__PURE__*/React.createElement(ChatBubble, {
    key: i,
    from: m.from === 'note' ? 'in' : m.from,
    note: m.from === 'note',
    author: m.author,
    time: m.time,
    status: m.status,
    attachment: m.attachment
  }, m.text))), /*#__PURE__*/React.createElement(Composer, {
    value: draft,
    onChange: setDraft,
    onSend: send,
    aiSuggestion: "Posso confirmar quinta (24/09) \xE0s 10:30 com a Dra. Helena?",
    quickReplies: QUICK_REPLIES
  })), /*#__PURE__*/React.createElement("aside", {
    className: "cz-scroll",
    style: {
      width: 'var(--context-panel-w)',
      flex: '0 0 auto',
      overflowY: 'auto',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border-hairline)',
      padding: 16,
      display: 'grid',
      gap: 16,
      alignContent: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: conv.name,
    size: "xl"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-strong)'
    }
  }, conv.name), /*#__PURE__*/React.createElement("div", {
    className: "cz-num",
    style: {
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, conv.phone)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    icon: "calendar-plus"
  }, "Agendar"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary",
    icon: "file-text"
  }, "Ficha"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cz-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Etiquetas"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 5,
      flexWrap: 'wrap'
    }
  }, (conv.tags || []).map(t => /*#__PURE__*/React.createElement(Tag, {
    key: t.label,
    color: t.color,
    size: "sm",
    onRemove: () => {}
  }, t.label)), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    icon: "plus"
  }, "Etiqueta"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cz-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Dados do paciente"), /*#__PURE__*/React.createElement("dl", {
    style: {
      margin: 0,
      display: 'grid',
      gap: 7
    }
  }, [['Convênio', 'Amil'], ['Profissional', 'Dra. Helena Reis'], ['Última consulta', '12/09/2026'], ['Próxima', '24/09/2026 · 10:30'], ['Origem', 'Indicação']].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 10,
      fontSize: 12.5
    }
  }, /*#__PURE__*/React.createElement("dt", {
    style: {
      color: 'var(--text-muted)'
    }
  }, k), /*#__PURE__*/React.createElement("dd", {
    className: "cz-num",
    style: {
      margin: 0,
      color: 'var(--text-body)',
      textAlign: 'right'
    }
  }, v))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cz-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Etapa da jornada"), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    defaultValue: "Em atendimento",
    options: ['Novo', 'Em atendimento', 'Agente de IA', 'Agendado', 'Resolvido']
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "cz-eyebrow",
    style: {
      marginBottom: 8
    }
  }, "Nota interna"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 10,
      borderRadius: 'var(--radius-sm)',
      background: 'var(--cz-warning-050)',
      color: 'var(--cz-warning-700)',
      fontSize: 12.5,
      lineHeight: 1.5
    }
  }, "Prefere hor\xE1rios pela manh\xE3. Sempre confirmar por WhatsApp."))));
}

/* ── Leads ──────────────────────────────────────────────────────── */
function ScreenLeads() {
  const [view, setView] = React.useState('kanban');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 'var(--page-gutter)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      height: '100%',
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(PageHeader, {
    title: "Leads",
    description: "Contatos que ainda n\xE3o viraram pacientes.",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SegmentedControl, {
      value: view,
      onChange: setView,
      options: [{
        value: 'kanban',
        label: 'Kanban',
        icon: 'columns-3'
      }, {
        value: 'lista',
        label: 'Lista',
        icon: 'list'
      }]
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "filter"
    }, "Filtros"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus"
    }, "Novo lead"))
  }), view === 'kanban' ? /*#__PURE__*/React.createElement("div", {
    className: "cz-scroll",
    style: {
      flex: 1,
      minHeight: 0,
      display: 'grid',
      gridTemplateColumns: `repeat(${LEAD_STAGES.length},minmax(228px,1fr))`,
      gap: 12,
      overflowX: 'auto',
      alignItems: 'start'
    }
  }, LEAD_STAGES.map(st => {
    const cards = LEADS.filter(l => l.stage === st.id);
    return /*#__PURE__*/React.createElement("div", {
      key: st.id,
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        minWidth: 0,
        background: 'var(--surface-sunken)',
        borderRadius: 'var(--radius-card)',
        padding: 10,
        maxHeight: '100%'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 7
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 7,
        height: 7,
        borderRadius: 2,
        background: st.tone
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12.5,
        fontWeight: 'var(--fw-bold)',
        color: 'var(--text-strong)'
      }
    }, st.label), /*#__PURE__*/React.createElement("span", {
      className: "cz-num",
      style: {
        fontSize: 11,
        color: 'var(--text-faint)'
      }
    }, cards.length), /*#__PURE__*/React.createElement(IconButton, {
      icon: "plus",
      label: "Adicionar lead",
      size: "sm",
      style: {
        marginLeft: 'auto'
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "cz-scroll",
      style: {
        display: 'grid',
        gap: 8,
        overflowY: 'auto',
        minHeight: 40
      }
    }, cards.length ? cards.map(l => /*#__PURE__*/React.createElement(KanbanCard, _extends({
      key: l.id
    }, l))) : /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '18px 8px',
        textAlign: 'center',
        fontSize: 11.5,
        color: 'var(--text-faint)'
      }
    }, "Nenhum lead aqui")));
  })) : /*#__PURE__*/React.createElement(Card, {
    padding: 0,
    style: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto'
    }
  }, /*#__PURE__*/React.createElement(DataTable, {
    rows: LEADS,
    columns: [{
      key: 'name',
      header: 'Lead',
      strong: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avatar, {
        name: r.name,
        size: "xs"
      }), r.name)
    }, {
      key: 'phone',
      header: 'WhatsApp',
      numeric: true,
      muted: true
    }, {
      key: 'meta',
      header: 'Contexto',
      muted: true,
      wrap: true
    }, {
      key: 'stage',
      header: 'Etapa',
      render: r => {
        const st = LEAD_STAGES.find(s => s.id === r.stage);
        return /*#__PURE__*/React.createElement("span", {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12.5
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            width: 7,
            height: 7,
            borderRadius: 2,
            background: st.tone
          }
        }), st.label);
      }
    }, {
      key: 'owner',
      header: 'Responsável',
      muted: true
    }, {
      key: 'value',
      header: 'Ticket',
      numeric: true,
      align: 'right'
    }, {
      key: 'waiting',
      header: 'Parado há',
      numeric: true,
      align: 'right',
      muted: true
    }]
  })));
}
Object.assign(window, {
  ScreenInicio,
  ScreenAtendimento,
  ScreenLeads
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/conduzza-chat/screens-operacao.jsx", error: String((e && e.message) || e) }); }

__ds_ns.ChatBubble = __ds_scope.ChatBubble;

__ds_ns.Composer = __ds_scope.Composer;

__ds_ns.ConversationItem = __ds_scope.ConversationItem;

__ds_ns.KanbanCard = __ds_scope.KanbanCard;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.BarChart = __ds_scope.BarChart;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.DonutChart = __ds_scope.DonutChart;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.Banner = __ds_scope.Banner;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Dropdown = __ds_scope.Dropdown;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.SearchField = __ds_scope.SearchField;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Textarea = __ds_scope.Textarea;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.SidebarNav = __ds_scope.SidebarNav;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.TopBar = __ds_scope.TopBar;

__ds_ns.AppointmentCard = __ds_scope.AppointmentCard;

})();
