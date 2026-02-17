const { request, createUser } = require('./helpers');

describe('Letter Preferences Routes', () => {

    // --- GET /api/letter-preferences ---
    describe('GET /api/letter-preferences', () => {
        it('returns defaults when no preferences saved', async () => {
            const { token } = await createUser();

            const res = await request()
                .get('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.isDefault).toBe(true);
            expect(res.body.data.full_name).toBeNull();
            expect(res.body.data.address).toBeNull();
            expect(res.body.data.phone).toBeNull();
            expect(res.body.data.email).toBeNull();
            expect(res.body.data.signature_name).toBeNull();
            expect(res.body.data.intro_text).toBeNull();
            expect(res.body.data.commitments_html).toBeNull();
        });

        it('requires authentication', async () => {
            const res = await request().get('/api/letter-preferences');
            expect(res.status).toBe(401);
        });

        it('returns saved preferences after PUT', async () => {
            const { token } = await createUser();

            // Save preferences first
            await request()
                .put('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ full_name: 'John Smith', address: '123 Main St' });

            // Now GET should return saved values
            const res = await request()
                .get('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.isDefault).toBe(false);
            expect(res.body.data.full_name).toBe('John Smith');
            expect(res.body.data.address).toBe('123 Main St');
        });

        it('users only see their own preferences', async () => {
            const { token: token1 } = await createUser({ email: 'user1@test.com' });
            const { token: token2 } = await createUser({ email: 'user2@test.com' });

            // User 1 saves preferences
            await request()
                .put('/api/letter-preferences')
                .set('Authorization', `Bearer ${token1}`)
                .send({ full_name: 'User One', address: '111 First St' });

            // User 2 should get defaults
            const res = await request()
                .get('/api/letter-preferences')
                .set('Authorization', `Bearer ${token2}`);

            expect(res.body.isDefault).toBe(true);
            expect(res.body.data.full_name).toBeNull();
        });
    });

    // --- PUT /api/letter-preferences ---
    describe('PUT /api/letter-preferences', () => {
        it('creates new preferences', async () => {
            const { token } = await createUser();

            const res = await request()
                .put('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    full_name: 'Jane Doe',
                    address: '456 Oak Ave\nSuite 200',
                    phone: '(555) 123-4567',
                    email: 'jane@example.com',
                    signature_name: 'Jane M. Doe',
                    signature_title: 'Member, FMDAC',
                    intro_text: 'I am a responsible hobbyist...',
                    commitments_html: 'Fill all holes\nRemove trash\nRespect boundaries',
                    closing_text: 'Thank you for considering my request.',
                    insurance_text: 'I carry $1M liability insurance.'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.full_name).toBe('Jane Doe');
            expect(res.body.data.address).toBe('456 Oak Ave\nSuite 200');
            expect(res.body.data.phone).toBe('(555) 123-4567');
            expect(res.body.data.email).toBe('jane@example.com');
            expect(res.body.data.signature_name).toBe('Jane M. Doe');
            expect(res.body.data.signature_title).toBe('Member, FMDAC');
            expect(res.body.data.intro_text).toBe('I am a responsible hobbyist...');
            expect(res.body.data.commitments_html).toBe('Fill all holes\nRemove trash\nRespect boundaries');
            expect(res.body.data.closing_text).toBe('Thank you for considering my request.');
            expect(res.body.data.insurance_text).toBe('I carry $1M liability insurance.');
            expect(res.body.data.id).toBeTruthy();
        });

        it('updates existing preferences', async () => {
            const { token } = await createUser();

            // Create initial prefs
            await request()
                .put('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ full_name: 'Original Name', phone: '555-0001' });

            // Update
            const res = await request()
                .put('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ full_name: 'Updated Name', phone: '555-9999', address: 'New Address' });

            expect(res.status).toBe(200);
            expect(res.body.data.full_name).toBe('Updated Name');
            expect(res.body.data.phone).toBe('555-9999');
            expect(res.body.data.address).toBe('New Address');
        });

        it('allows saving partial preferences', async () => {
            const { token } = await createUser();

            const res = await request()
                .put('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ full_name: 'Just A Name' });

            expect(res.status).toBe(200);
            expect(res.body.data.full_name).toBe('Just A Name');
            expect(res.body.data.address).toBeNull();
            expect(res.body.data.phone).toBeNull();
        });

        it('requires authentication', async () => {
            const res = await request()
                .put('/api/letter-preferences')
                .send({ full_name: 'Test' });
            expect(res.status).toBe(401);
        });

        it('allows clearing fields by sending null', async () => {
            const { token } = await createUser();

            // Save a preference
            await request()
                .put('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ full_name: 'Name', phone: '555-1234' });

            // Clear phone by sending null
            const res = await request()
                .put('/api/letter-preferences')
                .set('Authorization', `Bearer ${token}`)
                .send({ full_name: 'Name', phone: null });

            expect(res.status).toBe(200);
            expect(res.body.data.full_name).toBe('Name');
            expect(res.body.data.phone).toBeNull();
        });
    });
});
