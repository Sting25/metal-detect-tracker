const { request, createUser, createAdmin, createDemoUser, createLegalContent, createLegalSuggestion } = require('./helpers');

describe('Legal Suggestions', () => {

    // =====================================================================
    // USER SUGGESTION ENDPOINTS
    // =====================================================================

    describe('POST /api/legal/suggestions', () => {
        it('creates a suggestion', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/legal/suggestions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    country_code: 'US',
                    suggestion_type: 'correction',
                    suggested_text: 'The ARPA section needs updating for 2026 changes.',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBeDefined();
        });

        it('requires auth (401 without token)', async () => {
            const res = await request()
                .post('/api/legal/suggestions')
                .send({
                    country_code: 'US',
                    suggested_text: 'Some suggestion',
                });
            expect(res.status).toBe(401);
        });

        it('requires suggested_text (400)', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/legal/suggestions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    country_code: 'US',
                });
            expect(res.status).toBe(400);
        });

        it('requires country_code (400)', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/legal/suggestions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    suggested_text: 'Some suggestion',
                });
            expect(res.status).toBe(400);
        });

        it('creates with legal_content_id linking to existing section', async () => {
            const { token } = await createUser();
            const section = await createLegalContent({
                section_key: 'arpa_test',
                section_title: 'ARPA',
                content_html: '<p>ARPA</p>',
            });

            const res = await request()
                .post('/api/legal/suggestions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    country_code: 'US',
                    legal_content_id: section.id,
                    suggestion_type: 'correction',
                    suggested_text: 'Updated ARPA text',
                    reason: 'Law changed in 2026',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('creates with all fields', async () => {
            const { token } = await createUser();
            const res = await request()
                .post('/api/legal/suggestions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    country_code: 'US',
                    region_code: 'CO',
                    suggestion_type: 'new_section',
                    section_title: 'Colorado New Law 2026',
                    suggested_text: 'Colorado passed a new metal detecting law...',
                    reason: 'New legislation enacted January 2026',
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('demo user cannot create suggestions (403)', async () => {
            const { token } = await createDemoUser();
            const res = await request()
                .post('/api/legal/suggestions')
                .set('Authorization', `Bearer ${token}`)
                .send({
                    country_code: 'US',
                    suggested_text: 'Some suggestion',
                });
            expect(res.status).toBe(403);
        });
    });

    describe('GET /api/legal/suggestions', () => {
        it('returns user own suggestions', async () => {
            const { user, token } = await createUser();
            await createLegalSuggestion(user.id, { suggested_text: 'Suggestion 1' });
            await createLegalSuggestion(user.id, { suggested_text: 'Suggestion 2' });

            const res = await request()
                .get('/api/legal/suggestions')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.data[0].suggested_text).toBeDefined();
        });

        it('requires auth (401)', async () => {
            const res = await request().get('/api/legal/suggestions');
            expect(res.status).toBe(401);
        });

        it('does not return other users suggestions', async () => {
            const user1 = await createUser({ email: 'user1@test.com' });
            const user2 = await createUser({ email: 'user2@test.com' });

            await createLegalSuggestion(user1.user.id, { suggested_text: 'User1 suggestion' });
            await createLegalSuggestion(user2.user.id, { suggested_text: 'User2 suggestion' });

            const res = await request()
                .get('/api/legal/suggestions')
                .set('Authorization', `Bearer ${user1.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].suggested_text).toBe('User1 suggestion');
        });
    });

    // =====================================================================
    // ADMIN SUGGESTION ENDPOINTS
    // =====================================================================

    describe('GET /api/admin/legal/suggestions', () => {
        it('lists all suggestions with user info', async () => {
            const admin = await createAdmin();
            const { user } = await createUser({ email: 'suggester@test.com', display_name: 'Suggester' });
            await createLegalSuggestion(user.id, { suggested_text: 'Fix this' });

            const res = await request()
                .get('/api/admin/legal/suggestions')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.suggestions).toHaveLength(1);
            expect(res.body.data.suggestions[0].user_display_name).toBe('Suggester');
            expect(res.body.data.total_count).toBe(1);
        });

        it('filters by status', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            await createLegalSuggestion(user.id, { status: 'pending' });
            await createLegalSuggestion(user.id, { status: 'approved' });
            await createLegalSuggestion(user.id, { status: 'rejected' });

            const res = await request()
                .get('/api/admin/legal/suggestions?status=pending')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.suggestions).toHaveLength(1);
            expect(res.body.data.suggestions[0].status).toBe('pending');
        });

        it('paginates correctly', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            // Create 5 suggestions
            for (let i = 0; i < 5; i++) {
                await createLegalSuggestion(user.id, { suggested_text: `Suggestion ${i}` });
            }

            const res = await request()
                .get('/api/admin/legal/suggestions?limit=2&page=2')
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.suggestions).toHaveLength(2);
            expect(res.body.data.total_count).toBe(5);
            expect(res.body.data.page).toBe(2);
        });

        it('regular user gets 403', async () => {
            const { token } = await createUser();
            const res = await request()
                .get('/api/admin/legal/suggestions')
                .set('Authorization', `Bearer ${token}`);
            expect(res.status).toBe(403);
        });
    });

    describe('GET /api/admin/legal/suggestions/:id', () => {
        it('returns single suggestion details', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            const section = await createLegalContent({ section_key: 'test_sec', section_title: 'Test' });
            const suggestion = await createLegalSuggestion(user.id, {
                legal_content_id: section.id,
                suggested_text: 'Fix this section',
            });

            const res = await request()
                .get(`/api/admin/legal/suggestions/${suggestion.id}`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.suggested_text).toBe('Fix this section');
            expect(res.body.data.linked_content).toBeDefined();
            expect(res.body.data.linked_content.section_title).toBe('Test');
        });

        it('returns 404 for non-existent suggestion', async () => {
            const admin = await createAdmin();
            const res = await request()
                .get('/api/admin/legal/suggestions/99999')
                .set('Authorization', `Bearer ${admin.token}`);
            expect(res.status).toBe(404);
        });
    });

    describe('PUT /api/admin/legal/suggestions/:id', () => {
        it('approves a suggestion', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            const suggestion = await createLegalSuggestion(user.id);

            const res = await request()
                .put(`/api/admin/legal/suggestions/${suggestion.id}`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ status: 'approved', admin_notes: 'Looks good' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('approved');
        });

        it('rejects a suggestion with notes', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            const suggestion = await createLegalSuggestion(user.id);

            const res = await request()
                .put(`/api/admin/legal/suggestions/${suggestion.id}`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ status: 'rejected', admin_notes: 'Not accurate' });

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('rejected');
        });

        it('requires valid status (400)', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            const suggestion = await createLegalSuggestion(user.id);

            const res = await request()
                .put(`/api/admin/legal/suggestions/${suggestion.id}`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ status: 'invalid_status' });

            expect(res.status).toBe(400);
        });

        it('returns 404 for non-existent suggestion', async () => {
            const admin = await createAdmin();
            const res = await request()
                .put('/api/admin/legal/suggestions/99999')
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ status: 'approved' });
            expect(res.status).toBe(404);
        });
    });

    // =====================================================================
    // APPLY FLOW
    // =====================================================================

    describe('POST /api/admin/legal/suggestions/:id/apply', () => {
        it('updates existing legal_content and creates revision', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            const section = await createLegalContent({
                section_key: 'apply_test',
                section_title: 'Original Title',
                content_html: '<p>Original content</p>',
                severity: 'ok',
            });
            const suggestion = await createLegalSuggestion(user.id, {
                legal_content_id: section.id,
                suggested_text: 'Updated content',
            });

            const res = await request()
                .post(`/api/admin/legal/suggestions/${suggestion.id}/apply`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({
                    content_html: '<p>Updated content from suggestion</p>',
                    section_title: 'Updated Title',
                    severity: 'warning',
                    change_summary: 'Applied user suggestion',
                });

            expect(res.status).toBe(200);
            expect(res.body.data.legal_content_id).toBe(section.id);

            // Verify legal content was updated
            const updatedRes = await request()
                .get(`/api/admin/legal/${section.id}`)
                .set('Authorization', `Bearer ${admin.token}`);
            expect(updatedRes.body.data.section_title).toBe('Updated Title');
            expect(updatedRes.body.data.content_html).toBe('<p>Updated content from suggestion</p>');

            // Verify revision was created
            const revRes = await request()
                .get(`/api/admin/legal/${section.id}/revisions`)
                .set('Authorization', `Bearer ${admin.token}`);
            expect(revRes.body.data).toHaveLength(1);
            expect(revRes.body.data[0].old_title).toBe('Original Title');
            expect(revRes.body.data[0].new_title).toBe('Updated Title');
            expect(revRes.body.data[0].revision_number).toBe(1);
        });

        it('sets suggestion status to applied', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            const section = await createLegalContent({ section_key: 'apply_status_test' });
            const suggestion = await createLegalSuggestion(user.id, { legal_content_id: section.id });

            await request()
                .post(`/api/admin/legal/suggestions/${suggestion.id}/apply`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ content_html: '<p>New content</p>' });

            // Check suggestion status
            const detailRes = await request()
                .get(`/api/admin/legal/suggestions/${suggestion.id}`)
                .set('Authorization', `Bearer ${admin.token}`);
            expect(detailRes.body.data.status).toBe('applied');
            expect(detailRes.body.data.reviewed_by).toBe(admin.user.id);
        });

        it('creates new section when no legal_content_id', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            const suggestion = await createLegalSuggestion(user.id, {
                country_code: 'US',
                region_code: 'TX',
                section_title: 'Texas New Law',
            });

            const res = await request()
                .post(`/api/admin/legal/suggestions/${suggestion.id}/apply`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({
                    content_html: '<p>New Texas law content</p>',
                    section_title: 'Texas New Law 2026',
                    severity: 'caution',
                });

            expect(res.status).toBe(200);
            expect(res.body.data.legal_content_id).toBeDefined();

            // Verify new section was created
            const sectionRes = await request()
                .get(`/api/admin/legal/${res.body.data.legal_content_id}`)
                .set('Authorization', `Bearer ${admin.token}`);
            expect(sectionRes.body.data.section_title).toBe('Texas New Law 2026');
            expect(sectionRes.body.data.country_code).toBe('US');
            expect(sectionRes.body.data.region_code).toBe('TX');
        });

        it('requires content_html (400)', async () => {
            const admin = await createAdmin();
            const { user } = await createUser();
            const suggestion = await createLegalSuggestion(user.id);

            const res = await request()
                .post(`/api/admin/legal/suggestions/${suggestion.id}/apply`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ section_title: 'Title only' });

            expect(res.status).toBe(400);
        });
    });

    // =====================================================================
    // REVISION AUTO-CREATION
    // =====================================================================

    describe('Auto-revision on admin PUT', () => {
        it('creates a revision row when admin updates legal content', async () => {
            const admin = await createAdmin();
            const section = await createLegalContent({
                section_key: 'revision_test',
                section_title: 'Original Title',
                content_html: '<p>Original</p>',
                severity: 'ok',
            });

            await request()
                .put(`/api/admin/legal/${section.id}`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({
                    section_title: 'Updated Title',
                    content_html: '<p>Updated</p>',
                    severity: 'warning',
                });

            // Check revision was created
            const revRes = await request()
                .get(`/api/admin/legal/${section.id}/revisions`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(revRes.status).toBe(200);
            expect(revRes.body.data).toHaveLength(1);
            expect(revRes.body.data[0].old_title).toBe('Original Title');
            expect(revRes.body.data[0].new_title).toBe('Updated Title');
            expect(revRes.body.data[0].old_content_html).toBe('<p>Original</p>');
            expect(revRes.body.data[0].new_content_html).toBe('<p>Updated</p>');
            expect(revRes.body.data[0].old_severity).toBe('ok');
            expect(revRes.body.data[0].new_severity).toBe('warning');
            expect(revRes.body.data[0].revision_number).toBe(1);
            expect(revRes.body.data[0].changed_by_name).toBe('Admin User');
        });
    });

    describe('GET /api/admin/legal/:id/revisions', () => {
        it('returns revision history ordered by revision_number DESC', async () => {
            const admin = await createAdmin();
            const section = await createLegalContent({
                section_key: 'multi_rev_test',
                section_title: 'V1',
                content_html: '<p>V1</p>',
            });

            // Make two updates
            await request()
                .put(`/api/admin/legal/${section.id}`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ section_title: 'V2', content_html: '<p>V2</p>' });

            await request()
                .put(`/api/admin/legal/${section.id}`)
                .set('Authorization', `Bearer ${admin.token}`)
                .send({ section_title: 'V3', content_html: '<p>V3</p>' });

            const res = await request()
                .get(`/api/admin/legal/${section.id}/revisions`)
                .set('Authorization', `Bearer ${admin.token}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(2);
            expect(res.body.data[0].revision_number).toBe(2); // Most recent first
            expect(res.body.data[1].revision_number).toBe(1);
        });

        it('returns 404 for non-existent section', async () => {
            const admin = await createAdmin();
            const res = await request()
                .get('/api/admin/legal/99999/revisions')
                .set('Authorization', `Bearer ${admin.token}`);
            expect(res.status).toBe(404);
        });
    });
});
