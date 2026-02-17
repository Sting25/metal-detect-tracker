const { request, createUser, createAdmin } = require('./helpers');
const db = require('../database');

describe('Feedback Routes', () => {

    describe('Submit Feedback', () => {
        it('POST /api/feedback creates feedback for authenticated user', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/feedback')
                .set('Authorization', `Bearer ${token}`)
                .send({ message: 'Great app!', type: 'suggestion' });

            expect(res.status).toBe(201);
            expect(res.body.data.message).toBe('Great app!');
            expect(res.body.data.type).toBe('suggestion');
            expect(res.body.data.status).toBe('new');
        });

        it('POST /api/feedback rejects empty message', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/feedback')
                .set('Authorization', `Bearer ${token}`)
                .send({ message: '', type: 'bug' });

            expect(res.status).toBe(400);
        });

        it('POST /api/feedback rejects invalid type', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/feedback')
                .set('Authorization', `Bearer ${token}`)
                .send({ message: 'Test', type: 'invalid_type' });

            expect(res.status).toBe(400);
        });
    });

    describe('Admin-only access', () => {
        it('GET /api/feedback returns 403 for non-admin', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/feedback')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(403);
        });

        it('GET /api/feedback returns all feedback for admin', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            // Submit feedback as regular user
            await request()
                .post('/api/feedback')
                .set('Authorization', `Bearer ${user.token}`)
                .send({ message: 'Feedback 1' });

            const res = await request()
                .get('/api/feedback')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
        });

        it('GET /api/feedback/stats returns counts for admin', async () => {
            const admin = await createAdmin();
            const user = await createUser();
            await request()
                .post('/api/feedback')
                .set('Authorization', `Bearer ${user.token}`)
                .send({ message: 'Test' });

            const res = await request()
                .get('/api/feedback/stats')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.total).toBe(1);
            expect(res.body.data.new).toBe(1);
        });

        it('PUT /api/feedback/:id updates status (admin only)', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            const createRes = await request()
                .post('/api/feedback')
                .set('Authorization', `Bearer ${user.token}`)
                .send({ message: 'Bug report' });

            const feedbackId = createRes.body.data.id;

            const res = await request()
                .put(`/api/feedback/${feedbackId}`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ status: 'reviewed', admin_notes: 'Looking into it' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('reviewed');
            expect(res.body.data.admin_notes).toBe('Looking into it');
        });

        it('DELETE /api/feedback/:id deletes record (admin only)', async () => {
            const admin = await createAdmin();
            const user = await createUser();

            const createRes = await request()
                .post('/api/feedback')
                .set('Authorization', `Bearer ${user.token}`)
                .send({ message: 'Delete me' });

            const feedbackId = createRes.body.data.id;

            const res = await request()
                .delete(`/api/feedback/${feedbackId}`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
        });
    });

    describe('Auth Enforcement', () => {
        it('returns 401 with no token', async () => {
            const res = await request().post('/api/feedback').send({ message: 'test' });
            expect(res.status).toBe(401);
        });
    });
});
