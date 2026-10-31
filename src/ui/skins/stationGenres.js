// Genres for popular Radio Browser stations whose tags and name say nothing
// about what they play. Each was looked up by hand (broadcaster, format,
// website) from the live catalog of 2026-10-31; stations whose format could
// not be confirmed are left out rather than guessed. Keyed by Radio Browser
// station UUID, which stays the same when a station edits its listing. Values
// are genre names from skinRadio.js.
export const STATION_GENRES = Object.freeze({
  // News and current affairs
  'b6eedfc6-4a4b-4899-852f-03dd833f1f1b': 'News', // Radio Farda (Radio Liberty Iran)
  'be24f32c-3b6e-4e35-9f52-f72a1d3584ca': 'News', // Radio Farda
  'a781a6da-a41f-498d-92f5-aede46952d54': 'News', // RFI Chinese
  '0013eb82-2dea-41f7-9534-936d0b2721b7': 'News', // TOK FM, Poland
  '14db05f4-b028-40dc-a13f-c53d068d929e': 'News', // Habertürk Radyo
  'e7fa0b65-8f5e-41dc-ad7e-b0697166475d': 'News', // Vesti FM
  '26a13ad6-ad3b-45de-a85d-e7dcc6af70e6': 'News', // Hír FM
  'eef37dac-e2b2-4f37-bb86-81ac3fe65135': 'News', // Capital 958, Singapore
  '98920fee-500c-49c8-a973-ff4179967f50': 'News', // Radio Rebelde, Cuba
  '64106b95-f582-473f-8c57-d6b62637e578': 'News', // RNE Radio Nacional
  'c76cf900-7a78-4831-9cab-5c5e35636cbc': 'News', // Kossuth Rádió
  'da2b0cdc-57c6-4c84-81bf-33e4e165c0d4': 'News', // Citi FM, Ghana
  '5c9ed574-3b9d-4431-826d-72cf10df46dc': 'News', // NPO Radio 1
  '7bd0a378-7d60-4363-8699-764af50f30c7': 'News', // Rai Radio 1
  // Talk
  '27d6243a-b636-4aa4-a121-065a88c730fa': 'Talk', // COPE A Coruña
  'cc3e7596-3e86-4e70-88e6-12b18cf1f019': 'Talk', // esRadio
  '0d24740e-2f73-4f4e-8b89-674d9e1e4ec5': 'Talk', // Somos Radio AM 530
  // Religious
  '5db41df8-9921-421f-a618-84864ededf86': 'Religious', // Quran radio, Cairo
  '62fbaf9d-c5ef-4b18-9e6a-cf9239ace46b': 'Religious', // Sheikh al-Maqrami lectures
  // Pop
  'f0ab0c5c-7125-476c-97a4-2eabc14f5f05': 'Pop', // Radio 538
  '447a1a5f-aee6-4b21-b85f-10ceb1896ad3': 'Pop', // Alpha FM São Paulo
  'e4f6d392-f704-4cf0-8d26-9c931cebeaf6': 'Pop', // Sveriges Radio P3
  '6ee52ee9-95c0-4e19-95fd-d9a9c345b7b3': 'Pop', // 988 FM, Malaysia
  '87e0e1df-a84c-4d3a-92c8-813a01bd7cc5': 'Pop', // Guangdong Music Radio
  '6973a0cb-0d2e-4329-abb5-92c153907504': 'Pop', // Radius FM, Belarus
  'bb410a35-2056-46c5-8fbe-574b78533171': 'Pop', // Bremen Vier
  '17be0284-0ab4-453f-9e98-f674df46a919': 'Pop', // NRK P3
  '45700958-16ab-422a-85bb-d402722463f0': 'Pop', // Galgalatz
  '377ec7c3-41fd-48d0-ab98-0c2485ec7d4d': 'Pop', // Radio MFM, Morocco
  '8153ae5a-0cb6-4ed2-b54d-6e24ca5be5b6': 'Pop', // LOVE 972, Singapore
  'a0d91c55-3965-4a03-a0b7-2e76c8faa2cd': 'Pop', // YES 933, Singapore
  '03fa5087-3dfd-410e-8930-6969afedb509': 'Pop', // Europa FM
  '6b500823-fc4e-4bf7-8bde-c2c08cd51fed': 'Pop', // 101.5 Kiss FM
  'e47c0813-93e0-45e7-9d82-d68bffff3032': 'Pop', // 101.7 Your Love FM
  '489f3786-3ff8-46c1-ad14-2a7c5d9cea99': 'Pop', // Energy Bern
  'c9f56165-ab64-4af8-ba90-dfb0aa735218': 'Pop', // hr3
  'd8f01eea-26be-4e3d-871d-7596e3ab8fb1': 'Pop', // SWR1 Baden-Württemberg
  '3bb2d57f-f7a6-49e7-afb5-89daf251de9d': 'Pop', // Radio Argovia
  '5d0149db-4923-4ac6-a45d-459dea9269cb': 'Pop', // Radio Hamburg
  'e777ff20-d45b-4ccd-81fa-ca0ab4ec229a': 'Pop', // NRJ Clermont
  '02dc8fb4-b5cd-425d-ae6a-2053e210e7af': 'Pop', // NRK mP3
  'd1edcf5b-d7e5-4ea7-9b3b-5913c2ecf9f6': 'Pop', // SR 1
  '3a23d0e2-4ceb-4439-a33a-6feb575b1bf6': 'Pop', // Otvoreni radio
  'bed86ed9-8c1c-4b90-a6f1-af2e3e267482': 'Pop', // Südtirol 1
  'ee662a9d-fa14-4d70-8d1d-b101ed6da89f': 'Pop', // ZIP FM
  '4f80d157-d676-4cd6-b106-adc37d720e44': 'Pop', // Kiss FM Armenia
  '977de2cd-f415-4085-82fe-f6b0c67f4d38': 'Pop', // Star FM, Zimbabwe
  '912ed691-5054-4316-a7af-3c5ec7cbc120': 'Pop', // Easy 97.2
  '319a9758-9b6b-4aa6-8415-432e43c46d1e': 'Pop', // Exclusively Madonna
  '80b3c98b-8a97-4b78-a53e-3e018ebea04c': 'Pop', // Radio Norge
  'c6d59222-e9e0-4c0e-a1b0-1b6372e21131': 'Latin', // Olímpica Stereo
  '0ea3de36-41ff-4049-a8e9-24c6e024490e': 'Latin', // La Mega 97.9
  '7a2f5726-23ff-4cce-a3ab-14e64bbce8ce': 'Dance & Electronic', // VOX FM
  // Oldies
  '87e3c4fa-7037-48a8-b083-3d81e1cea592': 'Oldies', // KLVZ Legends
  'f4aea998-df4a-437b-ad2d-d160c821f91b': 'Oldies', // Radio 10
  '0aa252ff-612a-48e9-841b-b3f561dc1c47': 'Oldies', // Bremen Eins
  '62220177-9f8b-48d0-a9bc-df4c9a3927c9': 'Oldies', // Soviet estrada
  'af35355e-a601-4530-a806-0a18d42a52c6': 'Oldies', // Veronica Top 1000
  // Rock and eclectic
  '399ca326-0f67-4015-a51b-d7ba2bd4ebbe': 'Rock', // KEXP
  '4aad9a26-15ef-4c13-a947-74c483181b4f': 'Eclectic', // Radio Paradise
  '4974ff56-f36a-48d9-a0bb-cd3b5ce07f31': 'Eclectic', // Dial Radio
  // World
  'e8c19fc3-7409-4999-a9dd-b3d81cf934ed': 'World', // Kan Gimel
  'f699e43f-b717-41d1-8d05-b5e07506a2d0': 'World', // Warna 942
  '088c2b87-4c3d-4fb0-ba51-f80690de89b0': 'World', // Azadi FM (Kurdish)
  'c55e3a0e-c091-4277-ab32-0f932fb44be4': 'World', // Dengê Cudî (Kurdish)
  'f090cb1e-5291-4642-a93b-f41b4b3a691d': 'World', // Govend Radyo (Kurdish)
  '4e2dee09-d692-42b7-aff6-7caced5b14d3': 'World', // Radio S3 Južni
  'fa0f6975-f097-4b61-89af-27f86bb69d19': 'World', // Radio S Narodni
  'ebdd105b-6d6d-41df-b783-20d32d6dc281': 'World', // Campursari Yogyakarta
  // Public and community broadcasters (mixed music and speech)
  'cf10fd7a-1d28-4fa2-b5dd-630c4781e1c8': 'Public & Community', // IRIB Gachsaran
  '4ba828bb-ec19-4285-b46d-1a534cddd8a9': 'Public & Community', // RTS Senegal
  'ac81df15-039c-43df-b944-7462426b9db5': 'Public & Community', // Ukhozi FM
  '3bdf2126-b792-46f6-b0bd-9c991411e373': 'Public & Community', // Thobela FM
  'ed03bcf5-86d2-45f7-848d-90d67f89e001': 'Public & Community', // ORF Oberösterreich
  'd6baa0a3-feb1-422f-86af-42375f5e7c0a': 'Public & Community', // ORF Niederösterreich
  '90ad59d7-68b5-4a49-addd-9498843da6f2': 'Public & Community', // Rádio Slovensko
  'ac551e97-29fe-4eb2-979f-7438ad647d15': 'Public & Community', // SR P4 Stockholm
  '39a437bb-aa17-420b-a748-41b35312d1de': 'Public & Community', // SR P4 Västerbotten
  'ebc6ab9f-57be-4ee8-9209-327ee71c7a86': 'Public & Community', // NRK P1 Stor-Oslo
  '98c9274f-903a-4779-a682-f2ba37ae7b09': 'Public & Community', // Jozi FM
  '7b33877d-9f67-44a0-b929-bce276a3806c': 'Public & Community', // Radio Macfast (campus)
});
