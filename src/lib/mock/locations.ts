export const MOCK_LOCATIONS = [
  ['SBU Academic Mall', 'Stony Brook University', 40.9126, -73.1234],
  ['SBU Student Activities Center', 'Stony Brook University', 40.9145, -73.1243],
  ['Stony Brook Village Center', 'Stony Brook, NY', 40.9178, -73.1462],
  ['Port Jefferson Village', 'Port Jefferson, NY', 40.9465, -73.0693],
  ['East Setauket', 'Setauket, NY', 40.9387, -73.0979],
  ['Smith Haven Mall', 'Lake Grove, NY', 40.8668, -73.1336],
  ['Centereach', 'Centereach, NY', 40.8584, -73.0996],
  ['Smithtown', 'Smithtown, NY', 40.8559, -73.2007],
].map(([label, detail, lat, lng], i) => ({
  id: `mock-loc-${i}`,
  label: label as string,
  detail: detail as string,
  center: { lat: lat as number, lng: lng as number },
}));
