const { request, createUser, createSite, createPermission, createReminder } = require('./helpers');
const db = require('../database');

describe('Reminders', () => {

    describe('CRUD', () => {
        it('POST creates a reminder', async () => {
            const { token, user } = await createUser();

            const res = await request()
                .post('/api/reminders')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    reminder_type: 'custom',
                    title: 'Check field conditions',
                    due_date: '2026-04-15',
                    notes: 'After rain stops',
                });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.title).toBe('Check field conditions');
            expect(res.body.data.reminder_type).toBe('custom');
            expect(res.body.data.is_completed).toBe(false);
            expect(res.body.data.user_id).toBe(user.id);
        });

        it('POST creates a reminder linked to a permission', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);
            const perm = await createPermission(user.id, site.id);

            const res = await request()
                .post('/api/reminders')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    permission_id: perm.id,
                    reminder_type: 'follow_up',
                    title: 'Follow up with landowner',
                    due_date: '2026-03-20',
                });

            expect(res.status).toBe(201);
            expect(res.body.data.permission_id).toBe(perm.id);
            expect(res.body.data.permission_name).toBe('BLM Office');
        });

        it('POST rejects without title (400)', async () => {
            const { token } = await createUser();

            const res = await request()
                .post('/api/reminders')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    reminder_type: 'custom',
                    due_date: '2026-04-15',
                });

            expect(res.status).toBe(400);
        });

        it('GET lists user reminders', async () => {
            const { token, user } = await createUser();
            await createReminder(user.id, { title: 'Reminder A', due_date: '2026-03-10' });
            await createReminder(user.id, { title: 'Reminder B', due_date: '2026-03-20' });

            const res = await request()
                .get('/api/reminders')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.count).toBe(2);
        });

        it('GET filters by completed=false', async () => {
            const { token, user } = await createUser();
            await createReminder(user.id, { title: 'Active' });
            const completedReminder = await createReminder(user.id, { title: 'Done' });
            await db.query('UPDATE reminders SET is_completed = true, completed_at = NOW() WHERE id = $1', [completedReminder.id]);

            const res = await request()
                .get('/api/reminders?completed=false')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].title).toBe('Active');
        });

        it('PUT updates a reminder', async () => {
            const { token, user } = await createUser();
            const reminder = await createReminder(user.id);

            const res = await request()
                .put(`/api/reminders/${reminder.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ title: 'Updated title', due_date: '2026-05-01' });

            expect(res.status).toBe(200);
            expect(res.body.data.title).toBe('Updated title');
        });

        it('PATCH complete toggles is_completed + sets completed_at', async () => {
            const { token, user } = await createUser();
            const reminder = await createReminder(user.id);

            // Complete
            const res1 = await request()
                .patch(`/api/reminders/${reminder.id}/complete`)
                .set('Authorization', `Bearer ${token}`)
                .send({ is_completed: true });

            expect(res1.status).toBe(200);
            expect(res1.body.data.is_completed).toBe(true);
            expect(res1.body.data.completed_at).toBeTruthy();

            // Uncomplete
            const res2 = await request()
                .patch(`/api/reminders/${reminder.id}/complete`)
                .set('Authorization', `Bearer ${token}`)
                .send({ is_completed: false });

            expect(res2.status).toBe(200);
            expect(res2.body.data.is_completed).toBe(false);
            expect(res2.body.data.completed_at).toBeNull();
        });

        it('DELETE removes a reminder', async () => {
            const { token, user } = await createUser();
            const reminder = await createReminder(user.id);

            const res = await request()
                .delete(`/api/reminders/${reminder.id}`)
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(reminder.id);

            const check = await db.queryOne('SELECT * FROM reminders WHERE id = $1', [reminder.id]);
            expect(check).toBeNull();
        });
    });

    describe('Access Control', () => {
        it('cannot access other user\'s reminders (403)', async () => {
            const userA = await createUser({ email: 'a@test.com' });
            const userB = await createUser({ email: 'b@test.com' });
            const reminder = await createReminder(userB.user.id);

            const res = await request()
                .put(`/api/reminders/${reminder.id}`)
                .set('Authorization', `Bearer ${userA.token}`)
                .send({ title: 'Hacked' });

            expect(res.status).toBe(403);
        });
    });

    describe('Auto-Reminder on Permission Expiration', () => {
        it('auto-creates expiration reminder when permission expiration_date is set', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);

            // Create permission with expiration 60 days from now
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + 60);
            const expirationDate = futureDate.toISOString().split('T')[0];

            const res = await request()
                .post('/api/permissions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    site_id: site.id,
                    land_type: 'blm',
                    agency_or_owner: 'Test Agency',
                    status: 'approved',
                    expiration_date: expirationDate,
                });

            expect(res.status).toBe(201);

            // Check auto-created reminder
            const reminders = await db.query(
                "SELECT * FROM reminders WHERE permission_id = $1 AND reminder_type = 'expiration'",
                [res.body.data.id]
            );
            expect(reminders.rows).toHaveLength(1);
            expect(reminders.rows[0].title).toContain('Test Agency');
        });

        it('auto-updates (not duplicates) expiration reminder on date change', async () => {
            const { token, user } = await createUser();
            const site = await createSite(user.id);

            // Create permission with expiration 60 days out
            const futureDate1 = new Date();
            futureDate1.setDate(futureDate1.getDate() + 60);
            const expDate1 = futureDate1.toISOString().split('T')[0];

            const createRes = await request()
                .post('/api/permissions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    site_id: site.id,
                    land_type: 'blm',
                    agency_or_owner: 'Agency X',
                    status: 'approved',
                    expiration_date: expDate1,
                });

            const permId = createRes.body.data.id;

            // Now update to 90 days out
            const futureDate2 = new Date();
            futureDate2.setDate(futureDate2.getDate() + 90);
            const expDate2 = futureDate2.toISOString().split('T')[0];

            await request()
                .put(`/api/permissions/${permId}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ expiration_date: expDate2 });

            // Should still be just 1 reminder (updated, not duplicated)
            const reminders = await db.query(
                "SELECT * FROM reminders WHERE permission_id = $1 AND reminder_type = 'expiration'",
                [permId]
            );
            expect(reminders.rows).toHaveLength(1);
        });
    });

    describe('Auth Enforcement', () => {
        it('returns 401 without token', async () => {
            const res = await request().get('/api/reminders');
            expect(res.status).toBe(401);
        });
    });
});
