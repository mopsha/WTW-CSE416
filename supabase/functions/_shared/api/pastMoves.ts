export interface PastMove {
  pickId: string;
  category: string;
  occurredAt: string;
  confirmedAt: string | null;
  winner: {
    placeId: string;
    name: string | null;
    locationText: string | null;
    origin: 'group_idea' | 'custom' | 'place';
  };
  group: { id: string; name: string } | null;
  participantCount: number | null;
  attendedCount: number | null;
}
export interface PastMovesResult {
  visible: boolean;
  pastMoves: PastMove[];
}
export interface PastMovesStore {
  list(viewerId: string, targetId: string, groupId: string | null): Promise<PastMovesResult>;
}
