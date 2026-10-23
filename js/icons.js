// Minimal inline icon set. Stroke icons inherit currentColor.
const paths = {
  play: '<path d="M7 4.5 19 12 7 19.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="4.5" width="3.5" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="3.5" height="15" rx="1" fill="currentColor" stroke="none"/>',
  step: '<path d="M5 5v14l9-7z" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2.2 6.5"/><path d="M4 4v6h6"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M20 12h-9a6 6 0 0 0-6 6v1"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h7V4M8 20v-6h8v6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  cursor: '<path d="m5 3 6.5 17 2.2-6.3L20 11.5z"/>',
  node: '<circle cx="12" cy="12" r="4"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
  road: '<path d="M8 3 5 21M16 3l3 18M12 4v3M12 11v3M12 18v3"/>',
  signal: '<rect x="8" y="2.5" width="8" height="15" rx="3"/><circle cx="12" cy="6.5" r="1.4"/><circle cx="12" cy="10" r="1.4"/><circle cx="12" cy="13.5" r="1.4"/><path d="M12 17.5V22M8 22h8"/>',
  detector: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8M12 8v8"/>',
  crosswalk: '<path d="M5 4v16M9 4v16M13 4v16M17 4v16M3 8h18M3 16h18"/>',
  car: '<path d="m5 16 1.2-5.2A2.5 2.5 0 0 1 8.6 9h6.8a2.5 2.5 0 0 1 2.4 1.8L19 16"/><path d="M4 16h16v3h-3v-2H7v2H4z"/><circle cx="7.5" cy="17" r="1"/><circle cx="16.5" cy="17" r="1"/>',
  bus: '<rect x="5" y="3" width="14" height="16" rx="2"/><path d="M5 10h14M8 19v2M16 19v2"/><circle cx="8.5" cy="15" r="1"/><circle cx="15.5" cy="15" r="1"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="m7 15 4-5 3 3 5-7"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6M10.5 7.5v6"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 4h16"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.8 2.2c-.8.5-1.3 1-1.3 2.3M12 17h.01"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  route: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h5a4 4 0 0 0 4-4V9a3 3 0 0 1 3-3"/>',
  controller: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h4M7 13h2M14 9h3M14 13h3M7 16h10"/>',
  pedestrian: '<circle cx="12" cy="4.5" r="2"/><path d="M12 6.5v6M12 8.5 8 11M12 8.5l4 2.5M12 12.5 9 18M12 12.5l3 5.5"/>',
  warning: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17h.01"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  camera: '<path d="M4 7h4l1.5-2h5L16 7h4v12H4z"/><circle cx="12" cy="13" r="4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  arrowRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  maximize: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  beaker: '<path d="M9 3h6M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 14h9"/>',
  pin: '<path d="M12 22s7-6.5 7-12A7 7 0 0 0 5 10c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
};

export function icon(name, className = '') {
  const body = paths[name] || paths.info;
  return `<svg class="ic ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconReady === '1') return;
    el.innerHTML = icon(el.dataset.icon) + el.innerHTML;
    el.dataset.iconReady = '1';
  });
}
