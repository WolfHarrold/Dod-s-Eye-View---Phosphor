- Australian weather (BoM): a new Weather layer loops the Bureau of
  Meteorology's Bairnsdale and Melbourne rain radars over Gippsland and
  Melbourne, and shows the latest temperature, wind and rain since 9am at 19
  stations, led by Latrobe Valley Airport. Station markers are coloured by
  temperature, and the Weather card lists the stations in view with a
  one-hour trend. Data comes through a new keyless `/api/bom` proxy; BoM
  products are free for non-commercial use only.
- Places of interest: a new Infrastructure layer marks heritage-listed places,
  Vicmap landmarks, museums and galleries, parks and picnic areas, and Google
  attractions rated 4 stars or more, across Victoria. It loads for the area in
  view once you zoom in, names the Traditional Owners whose Country you are
  looking at, and shows Durt-Yowan (Latrobe River) by its Gunaikurnai name.
  Data comes through a new `/api/local-places` proxy; Google ratings need the
  existing Google server key.
