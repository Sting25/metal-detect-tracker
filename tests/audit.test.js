const { request, createUser, createAdmin, createSite, createFind, createPermission, shareSite, createDemoUser } = require('./helpers');
const db = require('../database');

/**
 * Poll for an audit event that may be inserted asynchronously (fire-and-forget).
 * Retries up to 10 times with 20ms intervals before giving up.
 */
async function waitForAuditEvent(sql, params, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        const row = await db.queryOne(sql, params);
        if (row) return row;
        await new Promise(r => setTimeout(r, 20));
    }
    return null;
}

describe('Audit Log', () => {

    // --- Unit: db.logAuditEvent() ---
    describe('db.logAuditEvent()', () => {
        it('inserts with all fields', async () => {
            const { user } = await createUser();
            await db.logAuditEvent({
                userId: user.id,
                action: 'test_action',
                entityType: 'test_entity',
                entityId: 42,
                details: { foo: 'bar', num: 123 },
                ipAddress: '127.0.0.1',
            });

            const row = await db.queryOne(
                'SELECT * FROM audit_events WHERE user_id = $1 AND action = $2',
                [user.id, 'test_action']
            );
            expect(row).toBeTruthy();
            expect(row.entity_type).toBe('test_entity');
            expect(row.entity_id).toBe(42);
            expect(row.details).toEqual({ foo: 'bar', num: 123 });
            expect(row.ip_address).toBe('127.0.0.1');
            expect(row.created_at).toBeTruthy();
        });

        it('handles null entityId', async () => {
            const { user } = await createUser();
            await db.logAuditEvent({
                userId: user.id,
                action: 'test_null_entity',
                entityType: 'test',
            });

            const row = await db.queryOne(
                'SELECT * FROM audit_events WHERE user_id = $1 AND action = $2',
                [user.id, 'test_null_entity']
            );
            expect(row).toBeTruthy();
            expect(row.entity_id).toBeNull();
        });

        it('handles null details', async () => {
            const { user } = await createUser();
            await db.logAuditEvent({
                userId: user.id,
                action: 'test_null_details',
                entityType: 'test',
                entityId: 1,
            });

            const row = await db.queryOne(
                'SELECT * FROM audit_events WHERE user_id = $1 AND action = $2',
                [user.id, 'test_null_details']
            );
            expect(row).toBeTruthy();
            expect(row.details).toBeNull();
        });

        it('handles null ipAddress', async () => {
            const { user } = await createUser();
            await db.logAuditEvent({
                userId: user.id,
                action: 'test_null_ip',
                entityType: 'test',
                entityId: 1,
                details: { x: 1 },
            });

            const row = await db.queryOne(
                'SELECT * FROM audit_events WHERE user_id = $1 AND action = $2',
                [user.id, 'test_null_ip']
            );
            expect(row).toBeTruthy();
            expect(row.ip_address).toBeNull();
        });

        it('does NOT throw on DB error (graceful degradation)', async () => {
            // Pass invalid userId to trigger a foreign key violation
            // logAuditEvent should silently catch and not throw
            await expect(
                db.logAuditEvent({
                    userId: 999999,
                    action: 'should_fail',
                    entityType: 'test',
                })
            ).resolves.not.toThrow();
        });

        it('stores JSONB details that are queryable', async () => {
            const { user } = await createUser();
            await db.logAuditEvent({
                userId: user.id,
                action: 'jsonb_test',
                entityType: 'test',
                entityId: 1,
                details: { site_name: 'Secret Spot', permission_level: 'edit' },
            });

            // Query using JSONB operator
            const row = await db.queryOne(
                "SELECT * FROM audit_events WHERE details->>'site_name' = $1",
                ['Secret Spot']
            );
            expect(row).toBeTruthy();
            expect(row.details.permission_level).toBe('edit');
        });
    });

    // --- Integration: Site deletion audit ---
    describe('Site deletion audit', () => {
        it('DELETE site creates site_delete audit event', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id, { name: 'Audit Test Site' });

            await request()
                .delete(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            const event = await waitForAuditEvent(
                'SELECT * FROM audit_events WHERE action = $1 AND entity_id = $2',
                ['site_delete', site.id]
            );
            expect(event).toBeTruthy();
            expect(event.user_id).toBe(user.id);
            expect(event.entity_type).toBe('site');
            expect(event.details).toBeTruthy();
            expect(event.details.name).toBe('Audit Test Site');
        });
    });

    // --- Integration: Find deletion audit ---
    describe('Find deletion audit', () => {
        it('DELETE find creates find_delete audit event', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);
            const find = await createFind(user.id, site.id, { description: 'Audit Test Find' });

            await request()
                .delete(`/api/finds/${find.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            const event = await waitForAuditEvent(
                'SELECT * FROM audit_events WHERE action = $1 AND entity_id = $2',
                ['find_delete', find.id]
            );
            expect(event).toBeTruthy();
            expect(event.user_id).toBe(user.id);
            expect(event.entity_type).toBe('find');
            expect(event.details.description).toBe('Audit Test Find');
        });
    });

    // --- Integration: Permission deletion audit ---
    describe('Permission deletion audit', () => {
        it('DELETE permission creates permission_delete audit event', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id, {
                land_type: 'blm',
                agency_or_owner: 'Test Agency',
            });

            await request()
                .delete(`/api/permissions/${perm.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            const event = await waitForAuditEvent(
                'SELECT * FROM audit_events WHERE action = $1 AND entity_id = $2',
                ['permission_delete', perm.id]
            );
            expect(event).toBeTruthy();
            expect(event.user_id).toBe(user.id);
            expect(event.entity_type).toBe('permission');
            expect(event.details.land_type).toBe('blm');
            expect(event.details.agency_or_owner).toBe('Test Agency');
        });
    });

    // --- Integration: Share creation audit ---
    describe('Share creation audit', () => {
        it('POST share creates share_create audit event', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);
            const { user: otherUser } = await createUser({ email: 'sharetest@test.com' });

            await request()
                .post(`/api/sites/${site.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .send({ email: otherUser.email, permission_level: 'view' })
                .expect(201);

            const event = await waitForAuditEvent(
                'SELECT * FROM audit_events WHERE action = $1 AND entity_id = $2',
                ['share_create', site.id]
            );
            expect(event).toBeTruthy();
            expect(event.user_id).toBe(user.id);
            expect(event.entity_type).toBe('site');
            expect(event.details.shared_with_email).toBe(otherUser.email);
            expect(event.details.permission_level).toBe('view');
        });

        it('POST share (update existing) creates share_update event', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);
            const { user: otherUser } = await createUser({ email: 'shareupdate@test.com' });

            // Create initial share
            await shareSite(site.id, user.id, otherUser.id, 'view');

            // Update to edit
            await request()
                .post(`/api/sites/${site.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .send({ email: otherUser.email, permission_level: 'edit' })
                .expect(201);

            const event = await waitForAuditEvent(
                'SELECT * FROM audit_events WHERE action = $1 AND entity_id = $2',
                ['share_update', site.id]
            );
            expect(event).toBeTruthy();
            expect(event.details.permission_level).toBe('edit');
        });
    });

    // --- Integration: Share removal audit ---
    describe('Share removal audit', () => {
        it('DELETE share creates share_remove audit event', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);
            const { user: otherUser } = await createUser({ email: 'removetest@test.com' });
            await shareSite(site.id, user.id, otherUser.id, 'view');

            await request()
                .delete(`/api/sites/${site.id}/share/${otherUser.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            const event = await waitForAuditEvent(
                'SELECT * FROM audit_events WHERE action = $1 AND entity_id = $2',
                ['share_remove', site.id]
            );
            expect(event).toBeTruthy();
            expect(event.user_id).toBe(user.id);
            expect(event.entity_type).toBe('site');
            expect(event.details.removed_user_id).toBe(otherUser.id);
        });
    });

    // --- Admin Audit API (Stage 0.2) ---
    describe('Admin Audit API', () => {
        it('returns paginated results with correct structure', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();

            // Create some audit events
            await db.logAuditEvent({ userId: user.id, action: 'site.create', entityType: 'site', entityId: 1, details: { name: 'Test' } });
            await db.logAuditEvent({ userId: user.id, action: 'find.create', entityType: 'find', entityId: 2, details: { material: 'copper' } });
            await db.logAuditEvent({ userId: admin.user.id, action: 'admin.user_role_change', entityType: 'user', entityId: user.id, details: { new_role: 'admin' } });

            const res = await request()
                .get('/api/admin/audit')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.events).toBeDefined();
            expect(res.body.data.events.length).toBe(3);
            expect(res.body.data.total_count).toBe(3);
            expect(res.body.data.page).toBe(1);
            expect(res.body.data.page_size).toBe(50);
            // Check JOIN data
            expect(res.body.data.events[0].user_display_name).toBeTruthy();
            expect(res.body.data.events[0].user_email).toBeTruthy();
        });

        it('filters by action', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();

            await db.logAuditEvent({ userId: user.id, action: 'site.create', entityType: 'site', entityId: 1 });
            await db.logAuditEvent({ userId: user.id, action: 'find.create', entityType: 'find', entityId: 2 });

            const res = await request()
                .get('/api/admin/audit?action=site.create')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.events.length).toBe(1);
            expect(res.body.data.events[0].action).toBe('site.create');
            expect(res.body.data.total_count).toBe(1);
        });

        it('filters by entity_type', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();

            await db.logAuditEvent({ userId: user.id, action: 'site.create', entityType: 'site', entityId: 1 });
            await db.logAuditEvent({ userId: user.id, action: 'find.create', entityType: 'find', entityId: 2 });

            const res = await request()
                .get('/api/admin/audit?entity_type=find')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.events.length).toBe(1);
            expect(res.body.data.events[0].entity_type).toBe('find');
        });

        it('filters by date range', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();

            await db.logAuditEvent({ userId: user.id, action: 'recent_action', entityType: 'test', entityId: 1 });

            // Backdate one event
            await db.logAuditEvent({ userId: user.id, action: 'old_action', entityType: 'test', entityId: 2 });
            await db.query(
                "UPDATE audit_events SET created_at = NOW() - INTERVAL '60 days' WHERE action = 'old_action'"
            );

            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            const res = await request()
                .get(`/api/admin/audit?start_date=${yesterday}&end_date=${today}`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.events.length).toBe(1);
            expect(res.body.data.events[0].action).toBe('recent_action');
        });

        it('non-admin gets 403', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/admin/audit')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
        });

        it('pagination works', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();

            await db.logAuditEvent({ userId: user.id, action: 'action_1', entityType: 'test', entityId: 1 });
            await db.logAuditEvent({ userId: user.id, action: 'action_2', entityType: 'test', entityId: 2 });
            await db.logAuditEvent({ userId: user.id, action: 'action_3', entityType: 'test', entityId: 3 });

            const page1 = await request()
                .get('/api/admin/audit?page=1&page_size=2')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(page1.status).toBe(200);
            expect(page1.body.data.events.length).toBe(2);
            expect(page1.body.data.total_count).toBe(3);

            const page2 = await request()
                .get('/api/admin/audit?page=2&page_size=2')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(page2.status).toBe(200);
            expect(page2.body.data.events.length).toBe(1);
        });

        it('GET /audit/actions returns distinct actions', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();

            await db.logAuditEvent({ userId: user.id, action: 'site.create', entityType: 'site', entityId: 1 });
            await db.logAuditEvent({ userId: user.id, action: 'find.create', entityType: 'find', entityId: 2 });
            await db.logAuditEvent({ userId: user.id, action: 'site.create', entityType: 'site', entityId: 3 });

            const res = await request()
                .get('/api/admin/audit/actions')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toContain('site.create');
            expect(res.body.data).toContain('find.create');
            // Should be deduplicated
            expect(res.body.data.filter(a => a === 'site.create').length).toBe(1);
        });

        it('filters by user_search', async () => {
            const admin = await createAdmin();
            const { user: user1 } = await createUser({ display_name: 'Alice Smith' });
            const { user: user2 } = await createUser({ display_name: 'Bob Jones' });

            await db.logAuditEvent({ userId: user1.id, action: 'site.create', entityType: 'site', entityId: 1 });
            await db.logAuditEvent({ userId: user2.id, action: 'find.create', entityType: 'find', entityId: 2 });

            const res = await request()
                .get('/api/admin/audit?user_search=Alice')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.events.length).toBe(1);
            expect(res.body.data.events[0].user_display_name).toBe('Alice Smith');
        });
    });

    // --- Expanded Audit Coverage (Stage 0.3) ---
    describe('Expanded Audit Coverage', () => {
        it('user registration (setup) creates user.register event', async () => {
            const res = await request()
                .post('/api/auth/setup')
                .send({ email: 'setupaudit@test.com', password: 'Password12345', display_name: 'Setup Audit' });

            expect(res.status).toBe(201);

            const event = await waitForAuditEvent(
                "SELECT * FROM audit_events WHERE action = 'user.register' AND user_id = $1",
                [res.body.data.user.id]
            );
            expect(event).toBeTruthy();
            expect(event.entity_type).toBe('user');
            expect(event.details.method).toBe('setup');
        });

        it('password login creates user.login event', async () => {
            const { user, password } = await createUser();

            await request()
                .post('/api/auth/login')
                .send({ email: user.email, password });

            const event = await waitForAuditEvent(
                "SELECT * FROM audit_events WHERE action = 'user.login' AND user_id = $1",
                [user.id]
            );
            expect(event).toBeTruthy();
            expect(event.details.method).toBe('password');
        });

        it('site create creates site.create event', async () => {
            const { user, token } = await createUser();

            const res = await request()
                .post('/api/sites')
                .set('Authorization', `Bearer ${token}`)
                .send({ name: 'Audit Site', latitude: 39.7, longitude: -104.9 });

            expect(res.status).toBe(201);

            const event = await waitForAuditEvent(
                "SELECT * FROM audit_events WHERE action = 'site.create' AND user_id = $1",
                [user.id]
            );
            expect(event).toBeTruthy();
            expect(event.entity_type).toBe('site');
            expect(event.details.name).toBe('Audit Site');
        });

        it('find create creates find.create event', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/finds')
                .set('Authorization', `Bearer ${token}`)
                .send({ site_id: site.id, date_found: '2026-01-15', material: 'copper', description: 'Test' });

            expect(res.status).toBe(201);

            const event = await waitForAuditEvent(
                "SELECT * FROM audit_events WHERE action = 'find.create' AND user_id = $1",
                [user.id]
            );
            expect(event).toBeTruthy();
            expect(event.entity_type).toBe('find');
            expect(event.details.material).toBe('copper');
        });

        it('permission create creates permission.create event', async () => {
            const { user, token } = await createUser();
            const site = await createSite(user.id);

            const res = await request()
                .post('/api/permissions')
                .set('Authorization', `Bearer ${token}`)
                .send({ site_id: site.id, land_type: 'blm', agency_or_owner: 'BLM Office', status: 'pending' });

            expect(res.status).toBe(201);

            const event = await waitForAuditEvent(
                "SELECT * FROM audit_events WHERE action = 'permission.create' AND user_id = $1",
                [user.id]
            );
            expect(event).toBeTruthy();
            expect(event.entity_type).toBe('permission');
            expect(event.details.land_type).toBe('blm');
        });

        it('admin role change creates admin.user_role_change event', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();

            await request()
                .put(`/api/admin/users/${user.id}/role`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ role: 'admin' });

            const event = await waitForAuditEvent(
                "SELECT * FROM audit_events WHERE action = 'admin.user_role_change' AND entity_id = $1",
                [user.id]
            );
            expect(event).toBeTruthy();
            expect(event.details.old_role).toBe('user');
            expect(event.details.new_role).toBe('admin');
        });
    });

    // --- Negative: No audit on failed delete ---
    describe('Negative cases', () => {
        it('failed delete (404) does NOT create audit event', async () => {
            const { token } = await createUser();

            await request()
                .delete('/api/sites/999999')
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            const events = await db.query(
                "SELECT * FROM audit_events WHERE action = 'site_delete' AND entity_id = 999999"
            );
            expect(events.rows.length).toBe(0);
        });

        it('demo user blocked mutation does NOT create audit event', async () => {
            const { user, token } = await createDemoUser();
            const site = await createSite(user.id);

            await request()
                .delete(`/api/sites/${site.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(403);

            const events = await db.query(
                "SELECT * FROM audit_events WHERE action = 'site_delete' AND entity_id = $1",
                [site.id]
            );
            expect(events.rows.length).toBe(0);
        });
    });
});
