import { createCandidateHours } from '../_shared/places/candidateHours.ts';
import { GoogleProvider } from '../_shared/places/GoogleProvider.ts';

export const refreshCandidateHours = createCandidateHours({
  async fetchHours(placeId, options) {
    // Lazy construction keeps mock/legacy reads independent of Google configuration.
    return new GoogleProvider(Deno.env.get('GOOGLE_PLACES_API_KEY') ?? '').fetchHours(
      placeId,
      options,
    );
  },
});
