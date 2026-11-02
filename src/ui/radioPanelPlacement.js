/** Keep Radio in Context in every theme, reusing the same playback controls. */
export function syncRadioPanelPlacement(doc) {
  if (!doc?.getElementById) return;
  const panel = doc.getElementById('radio-panel');
  const context = doc.getElementById('global-context-panel');
  const dock = doc.getElementById('context-radio-dock');
  const mini = doc.getElementById('context-radio-mini');
  const parent =
    context?.querySelector('.cyber-panel-body') ||
    context?.querySelector('.global-context-panel-inner');
  const header = context?.querySelector('.panel-header');
  if (!panel || !parent || !header || !dock || !mini) return;
  // A skin's floating window holds the panel until it is closed.
  if (
    panel.parentElement !== parent &&
    !panel.classList?.contains('skin-window')
  )
    parent.append(panel);
  if (dock.parentElement !== header)
    header.insertBefore(dock, header.querySelector('.panel-collapse-btn'));
  if (mini.parentElement !== dock) dock.append(mini);
}
