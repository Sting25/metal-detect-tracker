const { request, createUser, createAdmin } = require('./helpers');

describe('Auth Middleware', () => {

    describe('verifyToken', () => {
        it('allows request with valid token', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/sites')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).not.toBe(401);
        });

        it('rejects missing Authorization header', async () => {
            const res = await request().get('/api/sites');
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/no token/i);
        });

        it('rejects malformed header (no Bearer prefix)', async () => {
            const res = await request()
                .get('/api/sites')
                .set('Authorization', 'Token some-token');
            expect(res.status).toBe(401);
        });

        it('rejects expired/invalid token', async () => {
            const res = await request()
                .get('/api/sites')
                .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjk5OX0.invalid');
            expect(res.status).toBe(401);
        });
    });

    describe('requireAdmin', () => {
        it('returns 403 when user role is not admin', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/admin/stats')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
        });

        it('allows admin through', async () => {
            const admin = await createAdmin();
            const res = await request()
                .get('/api/admin/stats')
                .set('Authorization', `Bearer ${admin.token}`);
            expect(res.status).toBe(200);
        });
    });
});
