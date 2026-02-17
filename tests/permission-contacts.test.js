const { request, createUser, createSite, createPermission, createContact } = require('./helpers');
const db = require('../database');

describe('Permission Contacts (Contact Log)', () => {

    describe('CRUD', () => {
        it('POST creates a contact for a permission', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/contacts`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    contact_type: 'phone_call',
                    outcome: 'positive',
                    notes: 'Spoke with landowner, very receptive',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.contact_type).toBe('phone_call');
            expect(res.body.data.outcome).toBe('positive');
            expect(res.body.data.notes).toBe('Spoke with landowner, very receptive');
            expect(res.body.data.permission_id).toBe(perm.id);
        });

        it('POST rejects invalid contact_type (400)', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/contacts`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    contact_type: 'carrier_pigeon',
                });

            expect(res.status).toBe(400);
        });

        it('GET lists contacts for a permission (ordered by date DESC)', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            // Create contacts with different dates
            await db.query(
                "INSERT INTO permission_contacts (permission_id, user_id, contact_type, outcome, notes, contact_date) VALUES ($1, $2, 'phone_call', 'positive', 'First call', '2026-01-01')",
                [perm.id, user.id]
            );
            await db.query(
                "INSERT INTO permission_contacts (permission_id, user_id, contact_type, outcome, notes, contact_date) VALUES ($1, $2, 'email', 'neutral', 'Follow-up email', '2026-02-15')",
                [perm.id, user.id]
            );

            const res = await request()
                .get(`/api/permissions/${perm.id}/contacts`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.count).toBe(2);
            // Most recent first
            expect(res.body.data[0].contact_type).toBe('email');
            expect(res.body.data[1].contact_type).toBe('phone_call');
        });

        it('PUT updates a contact', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const contact = await createContact(perm.id, user.id);

            const res = await request()
                .put(`/api/permissions/${perm.id}/contacts/${contact.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ outcome: 'negative', notes: 'Changed mind' });

            expect(res.status).toBe(200);
            expect(res.body.data.outcome).toBe('negative');
            expect(res.body.data.notes).toBe('Changed mind');
            expect(res.body.data.contact_type).toBe('phone_call'); // unchanged
        });

        it('DELETE removes a contact', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            const contact = await createContact(perm.id, user.id);

            const res = await request()
                .delete(`/api/permissions/${perm.id}/contacts/${contact.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(contact.id);

            // Verify deletion
            const check = await db.queryOne('SELECT * FROM permission_contacts WHERE id = $1', [contact.id]);
            expect(check).toBeNull();
        });
    });

    describe('Access Control', () => {
        it('cannot access other user\'s permission contacts (403)', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const site = await createSite(userB.user.id);
            const perm = await createPermission(userB.user.id, site.id);
            await createContact(perm.id, userB.user.id);

            const res = await request()
                .get(`/api/permissions/${perm.id}/contacts`)
                .set('Authorization', `Bearer ${userA.token}`);

            expect(res.status).toBe(403);
        });

        it('cannot create contact on other user\'s permission (403)', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const site = await createSite(userB.user.id);
            const perm = await createPermission(userB.user.id, site.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/contacts`)
                .set('Authorization', `Bearer ${userA.token}`)
                .send({ contact_type: 'phone_call' });

            expect(res.status).toBe(403);
        });
    });

    describe('Cascade Deletion', () => {
        it('deleting permission deletes its contacts', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);
            await createContact(perm.id, user.id);
            await createContact(perm.id, user.id, { contact_type: 'email' });

            // Verify contacts exist
            const before = await db.query('SELECT * FROM permission_contacts WHERE permission_id = $1', [perm.id]);
            expect(before.rows).toHaveLength(2);

            // Delete permission
            await request()
                .delete(`/api/permissions/${perm.id}`)
                .set('Authorization', `Bearer ${token}`);

            // Contacts should be gone
            const after = await db.query('SELECT * FROM permission_contacts WHERE permission_id = $1', [perm.id]);
            expect(after.rows).toHaveLength(0);
        });
    });

    describe('Outcome follow_up_needed', () => {
        it('POST with outcome=follow_up_needed creates contact', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .post(`/api/permissions/${perm.id}/contacts`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    contact_type: 'in_person',
                    outcome: 'follow_up_needed',
                    notes: 'Need to send documents',
                });

            expect(res.status).toBe(201);
            expect(res.body.data.outcome).toBe('follow_up_needed');
        });
    });

    describe('Auth Enforcement', () => {
        it('returns 401 without token', async () => {
            const { user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .get(`/api/permissions/${perm.id}/contacts`);

            expect(res.status).toBe(401);
        });
    });
});
