const { request, createUser, createSite, createFind, shareSite } = require('./helpers');

describe('Shared site integration workflows', () => {
  // -----------------------------------------------------------------------
  // 1. Edit-shared user can create finds on the shared site
  // -----------------------------------------------------------------------
  it('edit-shared user can create finds on the shared site', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const editor = await createUser({ display_name: 'Editor' });
    const site = await createSite(owner.user.id, { name: 'Shared Edit Site' });

    await shareSite(site.id, owner.user.id, editor.user.id, 'edit');

    // Editor creates a find on the shared site
    const res = await request()
      .post('/api/finds')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        site_id: site.id,
        description: 'Editor find',
        date_found: '2026-03-01',
        material: 'silver',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.site_id).toBe(site.id);
    expect(res.body.data.description).toBe('Editor find');
  });

  // -----------------------------------------------------------------------
  // 2. View-shared user can see finds but cannot create them
  // -----------------------------------------------------------------------
  it('view-shared user can see finds on the shared site', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const viewer = await createUser({ display_name: 'Viewer' });
    const site = await createSite(owner.user.id, { name: 'Shared View Site' });
    const find = await createFind(owner.user.id, site.id, { description: 'Owner find' });

    await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

    // Viewer can list finds and see the owner's find
    const listRes = await request()
      .get('/api/finds')
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    const sharedFind = listRes.body.data.find(f => f.id === find.id);
    expect(sharedFind).toBeDefined();
    expect(sharedFind.description).toBe('Owner find');

    // Viewer can fetch the individual find
    const getRes = await request()
      .get(`/api/finds/${find.id}`)
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(find.id);
  });

  it('view-shared user cannot update finds on the shared site', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const viewer = await createUser({ display_name: 'Viewer' });
    const site = await createSite(owner.user.id, { name: 'View Site' });
    const find = await createFind(owner.user.id, site.id, { description: 'Owner find' });

    await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

    // Viewer cannot update the owner's find
    const res = await request()
      .put(`/api/finds/${find.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ description: 'Hacked description' });

    expect(res.status).toBe(403);
  });

  // -----------------------------------------------------------------------
  // 3. Find created by shared user is visible to site owner
  // -----------------------------------------------------------------------
  it('find created by edit-shared user is visible to site owner', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const editor = await createUser({ display_name: 'Editor' });
    const site = await createSite(owner.user.id, { name: 'Collab Site' });

    await shareSite(site.id, owner.user.id, editor.user.id, 'edit');

    // Editor creates a find
    const createRes = await request()
      .post('/api/finds')
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        site_id: site.id,
        description: 'Editor discovery',
        date_found: '2026-03-10',
        material: 'gold',
      });

    expect(createRes.status).toBe(201);
    const editorFindId = createRes.body.data.id;

    // Owner can see the find in their finds list (via site_id on an owned site)
    const ownerListRes = await request()
      .get(`/api/finds?site_id=${site.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(ownerListRes.status).toBe(200);
    const editorFind = ownerListRes.body.data.find(f => f.id === editorFindId);
    expect(editorFind).toBeDefined();
    expect(editorFind.description).toBe('Editor discovery');

    // Owner can fetch the individual find
    const ownerGetRes = await request()
      .get(`/api/finds/${editorFindId}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(ownerGetRes.status).toBe(200);
    expect(ownerGetRes.body.data.description).toBe('Editor discovery');
  });

  // -----------------------------------------------------------------------
  // 4. Deleting a shared site cascade-deletes finds and shares
  // -----------------------------------------------------------------------
  it('deleting a shared site removes finds and shares via cascade', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const editor = await createUser({ display_name: 'Editor' });
    const site = await createSite(owner.user.id, { name: 'Doomed Site' });

    await shareSite(site.id, owner.user.id, editor.user.id, 'edit');
    await createFind(owner.user.id, site.id, { description: 'Owner find' });
    await createFind(editor.user.id, site.id, { description: 'Editor find' });

    // Owner deletes the site
    const deleteRes = await request()
      .delete(`/api/sites/${site.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    // Site is gone
    const siteRes = await request()
      .get(`/api/sites/${site.id}`)
      .set('Authorization', `Bearer ${owner.token}`);

    expect(siteRes.status).toBe(404);

    // Finds on that site are gone (owner sees none for that site)
    const findsRes = await request()
      .get('/api/finds')
      .set('Authorization', `Bearer ${owner.token}`);

    expect(findsRes.status).toBe(200);
    const remainingFinds = findsRes.body.data.filter(f => f.site_id === site.id);
    expect(remainingFinds).toHaveLength(0);

    // Editor also sees no finds from that site
    const editorFindsRes = await request()
      .get('/api/finds')
      .set('Authorization', `Bearer ${editor.token}`);

    expect(editorFindsRes.status).toBe(200);
    const editorRemaining = editorFindsRes.body.data.filter(f => f.site_id === site.id);
    expect(editorRemaining).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // 5. Shared user cannot delete the site itself
  // -----------------------------------------------------------------------
  it('shared user (edit) cannot delete the site', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const editor = await createUser({ display_name: 'Editor' });
    const site = await createSite(owner.user.id, { name: 'Protected Site' });

    await shareSite(site.id, owner.user.id, editor.user.id, 'edit');

    const res = await request()
      .delete(`/api/sites/${site.id}`)
      .set('Authorization', `Bearer ${editor.token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    // Site still exists
    const getRes = await request()
      .get(`/api/sites/${site.id}`)
      .set('Authorization', `Bearer ${editor.token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe('Protected Site');
  });

  it('shared user (view) cannot delete the site', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const viewer = await createUser({ display_name: 'Viewer' });
    const site = await createSite(owner.user.id, { name: 'View-Only Site' });

    await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

    const res = await request()
      .delete(`/api/sites/${site.id}`)
      .set('Authorization', `Bearer ${viewer.token}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 6. Shared user cannot re-share the site to a third user
  // -----------------------------------------------------------------------
  it('shared user (edit) cannot re-share the site to a third user', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const editor = await createUser({ display_name: 'Editor' });
    const thirdUser = await createUser({ display_name: 'Third User' });
    const site = await createSite(owner.user.id, { name: 'No Re-share Site' });

    await shareSite(site.id, owner.user.id, editor.user.id, 'edit');

    // Editor tries to share the site with a third user
    const res = await request()
      .post(`/api/sites/${site.id}/share`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ email: thirdUser.user.email, permission_level: 'view' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('shared user (view) cannot re-share the site to a third user', async () => {
    const owner = await createUser({ display_name: 'Owner' });
    const viewer = await createUser({ display_name: 'Viewer' });
    const thirdUser = await createUser({ display_name: 'Third User' });
    const site = await createSite(owner.user.id, { name: 'No Re-share Site 2' });

    await shareSite(site.id, owner.user.id, viewer.user.id, 'view');

    const res = await request()
      .post(`/api/sites/${site.id}/share`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ email: thirdUser.user.email, permission_level: 'view' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
