- The skin radio finder now copes with the live directory. Feeling Lucky and
  next/previous skip a station that will not play (an error, or no sound after
  15 seconds) and try the next one, up to four in a row; stations that failed
  show OFF AIR in the finder. The Genre tab groups stations into about twenty
  genres instead of one group per free-text tag (80s, 80er and 80's were three
  groups, and network tags such as "dab" became genres), and station names
  show "&" instead of "&amp;". `tools/radio-live-probe.mjs` checks the
  directory, the finder views and a sample of streams against live stations.
