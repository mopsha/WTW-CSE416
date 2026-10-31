import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { localConfig, request, requireStatus } from './local.mjs';

// Groups end to end: real HTTP -> Auth -> Edge Function -> 0012 RPCs -> local Postgres,
// and the app's own RLS reads (src/lib/queries.ts) with each user's token.
// Friends come from 0008_friendships (PR #24). Without that table, adding anyone must
// fail closed (403 NOT_FRIENDS); the member is then inserted directly so the RLS and
// group-Pick checks still run.
test('local groups integration', { timeout: 120_000 }, async (t) => {
  const config = localConfig();
  const users = [];
  const run = randomUUID();
  const db = (path, options = {}) =>
    request(config, `/rest/v1/${path}`, { ...options, key: config.service, token: config.service });
  const api = (path, token, body) =>
    request(config, `/functions/v1/api${path}`, { method: 'POST', token, body });
  const as = async (who, path) =>
    requireStatus(await request(config, `/rest/v1/${path}`, { token: who.token }), 200, 'RLS read');
  async function user(role) {
    const password = `Test-only-${randomUUID()}!`;
    const email = `wtw-${run}-${role}@example.com`;
    const created = requireStatus(
      await request(config, '/auth/v1/admin/users', {
        method: 'POST',
        key: config.service,
        token: config.service,
        body: { email, password, email_confirm: true, user_metadata: { display_name: role } },
      }),
      200,
      'create local user',
    );
    users.push(created.id);
    const session = requireStatus(
      await request(config, '/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email, password },
      }),
      200,
      'sign in local user',
    );
    return { id: created.id, token: session.access_token };
  }
  const draft = { category: 'food', center: { lat: 40.9, lng: -73.1 }, radiusM: 1000 };
  // The exact selects the app uses.
  const listGroups = (who) =>
    as(
      who,
      `group_members?select=groups(id,name,owner_id,group_members(count))&user_id=eq.${who.id}`,
    );
  const getGroup = (who, id) =>
    as(
      who,
      `groups?select=id,name,owner_id,group_members(user_id,role,profiles(display_name))&id=eq.${id}`,
    );
  const groupPicks = (who, id) => as(who, `picks?select=id,state&group_id=eq.${id}`);

  try {
    const owner = await user('Owner');
    const friend = await user('Friend');
    const stranger = await user('Stranger');

    const created = await api('/groups', owner.token, { name: '  Roommates ' });
    assert.equal(created.status, 201);
    assert.equal(created.data.name, 'Roommates');
    const groupId = created.data.id;

    const notFriend = await api(`/groups/${groupId}/members`, owner.token, {
      userIds: [stranger.id],
    });
    assert.equal(notFriend.status, 403);
    assert.equal(notFriend.data.error.code, 'NOT_FRIENDS');

    const hasFriendships = (await db('friendships?select=status&limit=1')).status === 200;
    if (hasFriendships) {
      requireStatus(
        await db('friendships', {
          method: 'POST',
          body: {
            requester_id: owner.id,
            addressee_id: friend.id,
            status: 'accepted',
            accepted_at: new Date().toISOString(),
          },
        }),
        201,
        'fixture friendship',
      );
      const added = await api(`/groups/${groupId}/members`, owner.token, { userIds: [friend.id] });
      assert.equal(added.status, 200);
      assert.deepEqual(added.data, { added: 1 });
    } else {
      t.diagnostic('0008_friendships not applied: checking that adding fails closed');
      const closed = await api(`/groups/${groupId}/members`, owner.token, { userIds: [friend.id] });
      assert.equal(closed.data?.error?.code, 'NOT_FRIENDS');
      requireStatus(
        await db('group_members', {
          method: 'POST',
          body: { group_id: groupId, user_id: friend.id },
        }),
        201,
        'fixture member',
      );
    }

    // RLS: members see the group, its members and their names; strangers see nothing.
    const mine = await listGroups(friend);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].groups.group_members[0].count, 2);
    const detail = await getGroup(friend, groupId);
    assert.deepEqual(
      detail[0].group_members.map((m) => [m.role, m.profiles?.display_name]).sort(),
      [
        ['member', 'Friend'],
        ['owner', 'Owner'],
      ],
    );
    assert.deepEqual(await listGroups(stranger), []);
    assert.deepEqual(await getGroup(stranger, groupId), []);
    assert.equal(
      (await api(`/groups/${groupId}/rename`, stranger.token, { name: 'Mine' })).status,
      404,
    );
    assert.equal(
      (await api(`/groups/${groupId}/rename`, friend.token, { name: 'Mine' })).status,
      403,
    );

    // A group Pick has every member; non-members can't start one or see it.
    const first = await api('/picks', owner.token, { ...draft, groupId });
    assert.equal(first.status, 201);
    assert.equal(first.data.added, 1);
    assert.equal((await groupPicks(friend, groupId)).length, 1);
    assert.deepEqual(await groupPicks(stranger, groupId), []);
    const sneaky = await api('/picks', stranger.token, { ...draft, groupId });
    assert.equal(sneaky.status, 404);
    assert.deepEqual(
      await as(stranger, 'picks?select=id'),
      [],
      'no Pick was created for the stranger',
    );

    // Removed: keeps the old Pick, not added to the new one, can't see the group.
    assert.equal(
      (await api(`/groups/${groupId}/members/${friend.id}/remove`, owner.token)).status,
      200,
    );
    const second = await api('/picks', owner.token, { ...draft, groupId });
    assert.equal(second.data.added, 0);
    const seen = await as(friend, 'picks?select=id');
    assert.deepEqual(
      seen.map((p) => p.id),
      [first.data.pickId],
    );
    assert.deepEqual(await getGroup(friend, groupId), []);

    // Invites: friends only.
    const invite = await api(`/picks/${second.data.pickId}/invite`, owner.token, {
      userIds: [stranger.id],
    });
    assert.equal(invite.status, 403);

    assert.equal((await api(`/groups/${groupId}/leave`, owner.token)).status, 409);
    assert.equal((await api(`/groups/${groupId}/delete`, owner.token)).status, 200);
    assert.equal((await as(friend, 'picks?select=id')).length, 1, 'past Pick survives deletion');
  } finally {
    // Picks and groups first (as the heartbeat test does): deleting an Auth user who is
    // still a Pick participant fails in 0002's version trigger, which runs as the Auth role.
    let failed = false;
    for (const id of users) {
      for (const path of [`picks?host_id=eq.${id}`, `groups?owner_id=eq.${id}`]) {
        try {
          requireStatus(await db(path, { method: 'DELETE' }), 204, 'cleanup rows');
        } catch {
          failed = true;
        }
      }
    }
    for (const id of users) {
      try {
        requireStatus(
          await request(config, `/auth/v1/admin/users/${id}`, {
            method: 'DELETE',
            key: config.service,
            token: config.service,
          }),
          200,
          'cleanup user',
        );
      } catch {
        failed = true;
      }
    }
    if (failed)
      throw new Error('Local fixture cleanup failed; reset the local database before retrying');
  }
});
