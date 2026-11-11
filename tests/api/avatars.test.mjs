import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { localConfig, request, requireStatus } from './local.mjs';

// Real Auth -> Edge -> Postgres -> Storage, including physical deletion. Never
// pointed at hosted projects: localConfig restricts the URL to fixed loopback ports.
test(
  'managed private photos: authorization, revisions, Storage denial and deletion',
  { timeout: 120_000 },
  async () => {
    const config = localConfig();
    const bytes = await readFile(new URL('./avatar-fixture.jpg', import.meta.url));
    const run = randomUUID();
    const users = [];
    let priorEvidenceRetention;
    let priorModerationReadiness;
    const sql = (query) =>
      execFileSync(
        'psql',
        [
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
          '-X',
          '-q',
          '-A',
          '-t',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          query,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 },
      ).trim();
    const groups = [];
    const picks = [];
    const db = (path, options = {}) =>
      request(config, `/rest/v1/${path}`, {
        ...options,
        key: config.service,
        token: config.service,
      });
    const api = (path, token, method = 'GET', body) =>
      request(config, `/functions/v1/api${path}`, { token, method, body });
    async function raw(path, token, method = 'GET', body, key = config.anon) {
      return fetch(`${config.url}${path}`, {
        method,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          apikey: key,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'image/jpeg' } : {}),
        },
      });
    }
    async function user(role) {
      const email = `wtw-photo-${run}-${role}@example.com`;
      const password = `Test-only-${randomUUID()}!`;
      const created = requireStatus(
        await request(config, '/auth/v1/admin/users', {
          method: 'POST',
          key: config.service,
          token: config.service,
          body: { email, password, email_confirm: true, user_metadata: { display_name: role } },
        }),
        200,
        'create local photo user',
      );
      users.push(created.id);
      const session = requireStatus(
        await request(config, '/auth/v1/token?grant_type=password', {
          method: 'POST',
          body: { email, password },
        }),
        200,
        'sign in photo user',
      );
      return { id: created.id, token: session.access_token, refresh: session.refresh_token };
    }
    async function state(owner) {
      return requireStatus(
        await db(
          `profiles?id=eq.${owner.id}&select=avatar_path,avatar_revision,avatar_deletion_pending`,
        ),
        200,
        'photo state',
      )[0];
    }
    async function getPhoto(owner, viewer, revision, status = 200) {
      const response = await raw(
        `/functions/v1/api/users/${owner.id}/avatar?revision=${revision}`,
        viewer?.token,
      );
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      if (status === 200) {
        assert.equal(response.headers.get('content-type'), 'image/jpeg');
        const image = new Uint8Array(await response.arrayBuffer());
        assert.equal(image[0], 255);
        assert.equal(image[1], 216);
      } else await response.arrayBuffer();
    }
    async function upload(owner, revision, body = bytes) {
      const response = await raw(
        `/functions/v1/api/me/avatar?revision=${revision}`,
        owner.token,
        'POST',
        body,
      );
      return { status: response.status, data: await response.json() };
    }
    async function storageExists(path) {
      const response = await raw(
        `/storage/v1/object/authenticated/profile-photos/${path}`,
        config.service,
        'GET',
        undefined,
        config.service,
      );
      await response.arrayBuffer();
      return response.status === 200;
    }
    try {
      const [owner, friend, pending, groupPeer, pickPeer, stranger] = await Promise.all(
        ['Owner', 'Friend', 'Pending', 'Group', 'Pick', 'Stranger'].map(user),
      );
      requireStatus(
        await db('friendships', {
          method: 'POST',
          body: [
            {
              requester_id: owner.id,
              addressee_id: friend.id,
              status: 'accepted',
              accepted_at: new Date().toISOString(),
            },
            // PostgREST bulk inserts require identical keys in every row.
            {
              requester_id: owner.id,
              addressee_id: pending.id,
              status: 'pending',
              accepted_at: null,
            },
          ],
        }),
        201,
        'photo friendships',
      );
      const groupId = randomUUID();
      groups.push(groupId);
      requireStatus(
        await db('groups', {
          method: 'POST',
          body: { id: groupId, name: 'Photo group', owner_id: owner.id },
        }),
        201,
        'photo group',
      );
      requireStatus(
        await db('group_members', {
          method: 'POST',
          body: [
            { group_id: groupId, user_id: owner.id, role: 'owner' },
            { group_id: groupId, user_id: groupPeer.id, role: 'member' },
          ],
        }),
        201,
        'photo group members',
      );
      const pickId = randomUUID();
      picks.push(pickId);
      requireStatus(
        await db('picks', {
          method: 'POST',
          body: {
            id: pickId,
            host_id: owner.id,
            category: 'food',
            center_lat: 40,
            center_lng: -73,
            radius_m: 1000,
          },
        }),
        201,
        'photo Pick',
      );
      requireStatus(
        await db('pick_participants', {
          method: 'POST',
          body: [
            { pick_id: pickId, user_id: owner.id },
            { pick_id: pickId, user_id: pickPeer.id },
          ],
        }),
        201,
        'photo participants',
      );

      const details = requireStatus(
        await api('/me/details', owner.token),
        200,
        'initial photo details',
      );
      assert.equal(details.avatarRevision, 0);
      assert.equal(details.avatarRef, null);
      priorEvidenceRetention = sql(
        "select coalesce(retention_seconds::text,'null') from private.photo_moderation_config",
      );
      priorModerationReadiness = sql(
        'select moderation_ready from private.photo_moderation_config',
      );
      assert.match(priorEvidenceRetention, /^(null|[0-9]+)$/);
      assert.ok(['t', 'f'].includes(priorModerationReadiness));
      sql(
        'update private.photo_moderation_config set retention_seconds=3600,moderation_ready=false',
      );
      const disabledCaps = requireStatus(
        await api('/avatars/capabilities', owner.token),
        200,
        'disabled capabilities',
      );
      assert.deepEqual(disabledCaps, { uploadsEnabled: false, reportsEnabled: false });
      assert.equal((await upload(owner, 0)).status, 503); // Raw HTTP bypasses all UI controls.
      assert.equal((await state(owner)).avatar_revision, 0);
      sql('update private.photo_moderation_config set moderation_ready=true');
      const first = await upload(owner, 0);
      assert.equal(first.status, 200);
      assert.equal(first.data.revision, 1);
      const original = await state(owner);
      assert.match(original.avatar_path, new RegExp(`^${owner.id}/[0-9a-f-]+\\.jpg$`));
      assert.equal(await storageExists(original.avatar_path), true);
      for (const viewer of [owner, friend, groupPeer, pickPeer]) await getPhoto(owner, viewer, 1);
      for (const viewer of [pending, stranger]) await getPhoto(owner, viewer, 1, 404);
      await getPhoto(owner, null, 1, 401);

      // A new token remains usable; no token or signed read URL is embedded in metadata.
      const refreshed = requireStatus(
        await request(config, '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: { refresh_token: owner.refresh },
        }),
        200,
        'refresh photo session',
      );
      owner.token = refreshed.access_token;
      await getPhoto(owner, owner, 1);
      const profile = requireStatus(await api('/me/details', owner.token), 200, 'managed profile');
      assert.equal(profile.avatarUrl, null);
      assert.deepEqual(profile.avatarRef, { userId: owner.id, revision: 1 });
      const batch = requireStatus(
        await api('/avatars/resolve', friend.token, 'POST', {
          userIds: [owner.id, stranger.id],
          viewerId: owner.id,
        }),
        200,
        'authorized photo batch',
      );
      assert.deepEqual(batch[owner.id].avatarRef, profile.avatarRef);
      assert.equal(batch[stranger.id], undefined);
      const pendingBatch = requireStatus(
        await api('/avatars/resolve', pending.token, 'POST', { userIds: [owner.id] }),
        200,
        'pending photo batch',
      );
      assert.equal(pendingBatch[owner.id], undefined);
      const friends = requireStatus(
        await api('/friends', friend.token),
        200,
        'friend photo reference',
      );
      assert.deepEqual(
        friends.friends.find((p) => p.userId === owner.id).avatarRef,
        profile.avatarRef,
      );

      for (const viewer of [owner, stranger]) {
        for (const prefix of ['authenticated/', 'public/', '']) {
          const response = await raw(
            `/storage/v1/object/${prefix}profile-photos/${original.avatar_path}`,
            viewer.token,
          );
          assert.notEqual(response.status, 200);
          await response.arrayBuffer();
        }
        const path = `${owner.id}/${randomUUID()}.jpg`;
        const write = await raw(
          `/storage/v1/object/profile-photos/${path}`,
          viewer.token,
          'POST',
          bytes,
        );
        assert.notEqual(write.status, 200);
        await write.arrayBuffer();
        assert.equal(await storageExists(path), false);
        const signed = await request(
          config,
          `/storage/v1/object/sign/profile-photos/${original.avatar_path}`,
          {
            method: 'POST',
            token: viewer.token,
            body: { expiresIn: 60 },
          },
        );
        assert.ok(signed.status >= 400);
      }
      const removedByClient = await request(config, '/storage/v1/object/profile-photos', {
        method: 'DELETE',
        token: owner.token,
        body: { prefixes: [original.avatar_path] },
      });
      // Storage may return a successful empty result for rows hidden by DELETE
      // RLS. Physical persistence, not the status alone, proves the denial.
      assert.ok([200, 400, 401, 403].includes(removedByClient.status));
      assert.equal(await storageExists(original.avatar_path), true);

      for (const terminal of ['completed', 'canceled']) {
        requireStatus(
          await db(`picks?id=eq.${pickId}`, {
            method: 'PATCH',
            body: { state: terminal },
          }),
          204,
          'finish photo Pick',
        );
        await getPhoto(owner, pickPeer, 1, 404);
        await getPhoto(owner, groupPeer, 1);
        await getPhoto(owner, friend, 1);
      }
      requireStatus(
        await db(`picks?id=eq.${pickId}`, {
          method: 'PATCH',
          body: { state: 'draft' },
        }),
        204,
        'restore active photo fixture',
      );
      await getPhoto(owner, pickPeer, 1);

      requireStatus(
        await db('blocks', {
          method: 'POST',
          body: { blocker_id: groupPeer.id, blocked_id: owner.id },
        }),
        201,
        'photo block',
      );
      await getPhoto(owner, groupPeer, 1, 404);
      requireStatus(
        await db(`blocks?blocker_id=eq.${groupPeer.id}&blocked_id=eq.${owner.id}`, {
          method: 'DELETE',
        }),
        204,
        'remove test block',
      );
      requireStatus(
        await db('blocks', {
          method: 'POST',
          body: { blocker_id: owner.id, blocked_id: groupPeer.id },
        }),
        201,
        'reverse photo block',
      );
      await getPhoto(owner, groupPeer, 1, 404);
      const blockedReport = requireStatus(
        await api('/reports', groupPeer.token, 'POST', {
          kind: 'profile_photo',
          targetId: owner.id,
          photoRevision: 1,
          reason: 'Spam',
        }),
        404,
        'blocked group member cannot report private photo',
      );
      assert.deepEqual(blockedReport, {
        error: { code: 'NOT_FOUND', message: 'Nothing to report here' },
      });
      // End this negative fixture: a shared group must not override a block.
      // Later positive report tests require an unblocked, authorized peer.
      requireStatus(
        await db(`blocks?blocker_id=eq.${owner.id}&blocked_id=eq.${groupPeer.id}`, {
          method: 'DELETE',
        }),
        204,
        'remove reverse test block',
      );
      await getPhoto(owner, groupPeer, 1);
      requireStatus(
        await db(`pick_participants?pick_id=eq.${pickId}&user_id=eq.${pickPeer.id}`, {
          method: 'DELETE',
        }),
        204,
        'remove photo participant',
      );
      await getPhoto(owner, pickPeer, 1, 404);

      assert.equal((await upload(owner, 1, Buffer.from('forged JPEG'))).status, 400);
      assert.equal((await upload(owner, 1, Buffer.alloc(1048577))).status, 400);
      assert.equal((await state(owner)).avatar_path, original.avatar_path);
      const replacements = await Promise.all([upload(owner, 1), upload(owner, 1)]);
      assert.deepEqual(replacements.map((r) => r.status).sort(), [200, 409]);
      const current = await state(owner);
      assert.equal(current.avatar_revision, 2);
      assert.notEqual(current.avatar_path, original.avatar_path);
      assert.equal(await storageExists(current.avatar_path), true);
      assert.equal(await storageExists(original.avatar_path), false);
      await getPhoto(owner, friend, 1, 404);
      await getPhoto(owner, friend, 2);

      requireStatus(
        await api('/me/avatar?revision=1', owner.token, 'DELETE'),
        409,
        'stale removal',
      );
      requireStatus(
        await api('/me/avatar?revision=2', owner.token, 'DELETE'),
        200,
        'remove current photo',
      );
      assert.equal(await storageExists(current.avatar_path), false);
      await getPhoto(owner, friend, 2, 404);
      assert.equal((await upload(owner, 3)).status, 200);
      const final = await state(owner);
      // Local-only fixture policy; not a production retention recommendation.

      assert.match(priorEvidenceRetention, /^(null|[0-9]+)$/);
      sql('update private.photo_moderation_config set retention_seconds=null');
      const photoReport = {
        kind: 'profile_photo',
        targetId: owner.id,
        photoRevision: 4,
        reason: 'Spam',
      };
      requireStatus(
        await api('/reports', friend.token, 'POST', photoReport),
        503,
        'reporting needs explicit policy',
      );
      sql('update private.photo_moderation_config set retention_seconds=3600');
      for (const denied of [owner, pending, stranger])
        requireStatus(
          await api('/reports', denied.token, 'POST', photoReport),
          404,
          'unauthorized photo report',
        );
      requireStatus(
        await api('/reports', friend.token, 'POST', photoReport),
        201,
        'report exact photo',
      );
      requireStatus(
        await api('/reports', friend.token, 'POST', photoReport),
        201,
        'duplicate report',
      );
      const reports = requireStatus(
        await db(
          `reports?reporter_id=eq.${friend.id}&target_kind=eq.profile_photo&target_id=eq.${owner.id}&select=id`,
        ),
        200,
        'private report lookup',
      );
      assert.equal(reports.length, 1);
      const rid = reports[0].id;

      // Same payload emitted by group member menus; no friendship is required.
      // Verify current visibility/revision immediately before the positive report.
      assert.equal(final.avatar_revision, photoReport.photoRevision);
      await getPhoto(owner, groupPeer, photoReport.photoRevision);
      requireStatus(
        await api('/reports', groupPeer.token, 'POST', photoReport),
        201,
        'group member reports current photo revision',
      );
      const memberReports = requireStatus(
        await db(
          `reports?reporter_id=eq.${groupPeer.id}&target_kind=eq.profile_photo&target_id=eq.${owner.id}&select=id,photo_revision`,
        ),
        200,
        'member photo report lookup',
      );
      assert.equal(memberReports.length, 1);
      assert.equal(memberReports[0].photo_revision, 4);
      const memberCurrent = requireStatus(
        await db('rpc/avatar_moderation_current', {
          method: 'POST',
          body: { p_report_id: memberReports[0].id },
        }),
        200,
        'member photo report enters existing moderation',
      );
      assert.equal(memberCurrent.revision, 4);
      assert.equal(memberCurrent.path, final.avatar_path);
      sql(
        `update public.reports set photo_expires_at=clock_timestamp()-interval '1 second' where id='${rid}'`,
      );
      const expiredReport = requireStatus(
        await api('/reports', friend.token, 'POST', photoReport),
        409,
        'expired report rejects false success',
      );
      assert.equal(expiredReport.error.code, 'PHOTO_REPORT_EXPIRED');
      requireStatus(
        await api('/reports', stranger.token, 'POST', photoReport),
        404,
        'expired metadata remains private',
      );
      const evidenceExpiry = await db('rpc/avatar_expire_evidence', { method: 'POST', body: {} });
      assert.ok([200, 204].includes(evidenceExpiry.status), 'release expired evidence');
      requireStatus(
        await api('/reports', friend.token, 'POST', photoReport),
        409,
        'cleaned report stays explicitly expired',
      );
      // Current review is separate from expired historical evidence; no fixture repin.
      sql('update private.photo_moderation_config set moderation_ready=false');
      assert.equal((await upload(owner, 4)).status, 503);
      await getPhoto(owner, friend, 4);
      const currentVerification = requireStatus(
        await db('rpc/avatar_moderation_current', { method: 'POST', body: { p_report_id: rid } }),
        200,
        'current photo verification',
      );
      assert.equal(currentVerification.path, final.avatar_path);
      assert.equal(currentVerification.revision, 4);

      const deniedModeration = await request(config, '/rest/v1/rpc/avatar_moderation_evidence', {
        token: friend.token,
        method: 'POST',
        body: { p_report_id: rid },
      });
      assert.ok([401, 403, 404].includes(deniedModeration.status));
      requireStatus(
        await db('rpc/avatar_moderation_evidence', { method: 'POST', body: { p_report_id: rid } }),
        404,
        'historical evidence remains expired',
      );
      requireStatus(
        await db('rpc/avatar_moderation_remove_current', {
          method: 'POST',
          body: {
            p_report_id: rid,
            p_revision: currentVerification.revision,
            p_path: currentVerification.path,
          },
        }),
        200,
        'operator current removal',
      );
      const reviewedMember = requireStatus(
        await db(`reports?id=eq.${memberReports[0].id}&select=reviewed_at,review_note`),
        200,
        'member photo report removal audit',
      );
      assert.ok(reviewedMember[0].reviewed_at);
      assert.match(reviewedMember[0].review_note, /Removed reported current photo revision 4/);
      await getPhoto(owner, friend, 4, 404);
      assert.equal((await upload(owner, 4)).status, 409);
      assert.equal(await storageExists(final.avatar_path), true); // Evidence is private and pinned.
      sql('update private.photo_moderation_config set moderation_ready=true');
      assert.equal((await upload(owner, 5)).status, 200);
      const afterModeration = await state(owner);
      sql('update private.photo_moderation_config set moderation_ready=false');
      requireStatus(await api('/me', owner.token, 'DELETE'), 200, 'delete photo account');
      assert.equal(await storageExists(final.avatar_path), false);
      assert.equal(await storageExists(afterModeration.avatar_path), false);
      await getPhoto(owner, friend, 4, 404);
      assert.equal(
        requireStatus(await db(`profiles?id=eq.${owner.id}&select=id`), 200, 'deleted profile')
          .length,
        0,
      );
    } finally {
      try {
        // Include abandoned concurrent candidates; never leave fixture objects behind.
        for (const id of users) {
          const listed = await request(config, '/storage/v1/object/list/profile-photos', {
            method: 'POST',
            key: config.service,
            token: config.service,
            body: { prefix: id, limit: 100 },
          });
          if (listed.status === 200 && listed.data.length)
            requireStatus(
              await request(config, '/storage/v1/object/profile-photos', {
                method: 'DELETE',
                key: config.service,
                token: config.service,
                body: { prefixes: listed.data.map((o) => `${id}/${o.name}`) },
              }),
              200,
              'clean photo fixtures',
            );
        }
        for (const id of picks)
          requireStatus(
            await db(`picks?id=eq.${id}`, { method: 'DELETE' }),
            204,
            'clean photo Pick',
          );
        for (const id of groups)
          requireStatus(
            await db(`groups?id=eq.${id}`, { method: 'DELETE' }),
            204,
            'clean photo group',
          );
        for (const id of users) {
          const result = await request(config, `/auth/v1/admin/users/${id}`, {
            method: 'DELETE',
            key: config.service,
            token: config.service,
          });
          assert.ok([200, 404].includes(result.status));
        }
      } finally {
        if (priorEvidenceRetention !== undefined && /^(null|[0-9]+)$/.test(priorEvidenceRetention))
          sql(
            `update private.photo_moderation_config set retention_seconds=${priorEvidenceRetention},moderation_ready=${priorModerationReadiness === 't' ? 'true' : 'false'}`,
          );
      }
    }
  },
);
