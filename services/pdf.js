/**
 * PDF letter generation service using pdfkit.
 * Builds a permission request letter from letter_preferences + permission + site data.
 * Returns a Buffer containing the PDF.
 */
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');

/**
 * Generate a permission letter PDF.
 * @param {Object} letterPrefs - user's letter_preferences row
 * @param {Object} permission  - the permission row (with agency_or_owner, contact fields, etc.)
 * @param {Object|null} site   - the linked site row (name, description, latitude, longitude)
 * @returns {Promise<Buffer>} PDF file as a Buffer
 */
async function generatePermissionLetter(letterPrefs, permission, site) {
    return new Promise(function (resolve, reject) {
        try {
            const doc = new PDFDocument({
                size: 'LETTER',
                margins: { top: 72, bottom: 72, left: 72, right: 72 },
            });

            const buffers = [];
            const passThrough = new PassThrough();
            passThrough.on('data', function (chunk) { buffers.push(chunk); });
            passThrough.on('end', function () { resolve(Buffer.concat(buffers)); });
            passThrough.on('error', reject);
            doc.pipe(passThrough);

            const pageWidth = 468; // 612 - 72 - 72

            // ---------------------------------------------------------------
            // Header: sender info
            // ---------------------------------------------------------------
            if (letterPrefs.full_name) {
                doc.fontSize(14).font('Helvetica-Bold').text(letterPrefs.full_name, { align: 'left' });
            }
            const headerLines = [letterPrefs.address, letterPrefs.phone, letterPrefs.email].filter(Boolean);
            if (headerLines.length > 0) {
                doc.fontSize(10).font('Helvetica');
                headerLines.forEach(function (line) {
                    doc.text(line, { align: 'left' });
                });
            }

            doc.moveDown(1);

            // ---------------------------------------------------------------
            // Date line
            // ---------------------------------------------------------------
            const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            doc.fontSize(10).font('Helvetica').text(dateStr, { align: 'left' });
            doc.moveDown(1);

            // ---------------------------------------------------------------
            // Recipient
            // ---------------------------------------------------------------
            const recipientLines = [
                permission.agency_or_owner,
                permission.contact_name,
                permission.contact_address,
            ].filter(Boolean);
            if (recipientLines.length > 0) {
                doc.fontSize(10).font('Helvetica');
                recipientLines.forEach(function (line) {
                    doc.text(line, { align: 'left' });
                });
                doc.moveDown(1);
            }

            // ---------------------------------------------------------------
            // Salutation
            // ---------------------------------------------------------------
            const salutationName = permission.contact_name || permission.agency_or_owner || 'Sir/Madam';
            doc.fontSize(10).font('Helvetica').text('Dear ' + salutationName + ',');
            doc.moveDown(0.5);

            // ---------------------------------------------------------------
            // Introduction paragraph
            // ---------------------------------------------------------------
            let introText = letterPrefs.intro_text || 'I am writing to request permission to use a metal detector on your property.';
            // Substitute {name} and {location} placeholders
            const siteName = (site && site.name) ? site.name : 'the property';
            let siteLocation = '';
            if (site) {
                if (site.latitude && site.longitude) {
                    siteLocation = site.latitude.toFixed(4) + ', ' + site.longitude.toFixed(4);
                }
                siteLocation = siteLocation || site.name || '';
            }
            introText = introText.replace(/\{name\}/g, salutationName).replace(/\{location\}/g, siteLocation || siteName);
            doc.fontSize(10).font('Helvetica').text(introText, { align: 'left', lineGap: 2 });
            doc.moveDown(0.5);

            // ---------------------------------------------------------------
            // Site details
            // ---------------------------------------------------------------
            if (site) {
                doc.fontSize(11).font('Helvetica-Bold').text('Site Details');
                doc.fontSize(10).font('Helvetica');
                doc.text('Name: ' + (site.name || 'N/A'));
                if (site.description) {
                    doc.text('Description: ' + site.description);
                }
                if (site.latitude && site.longitude) {
                    doc.text('Location: ' + site.latitude.toFixed(4) + ', ' + site.longitude.toFixed(4));
                }
                doc.moveDown(0.5);
            }

            // ---------------------------------------------------------------
            // Commitments
            // ---------------------------------------------------------------
            const commitmentsText = letterPrefs.commitments_html || '';
            if (commitmentsText) {
                doc.fontSize(11).font('Helvetica-Bold').text('My Commitments');
                doc.fontSize(10).font('Helvetica');
                const commitments = commitmentsText.split('\n').filter(function (line) { return line.trim(); });
                commitments.forEach(function (c) {
                    doc.text('\u2022 ' + c.trim(), { indent: 10, lineGap: 2 });
                });
                doc.moveDown(0.5);
            }

            // ---------------------------------------------------------------
            // Insurance text
            // ---------------------------------------------------------------
            if (letterPrefs.insurance_text) {
                doc.fontSize(11).font('Helvetica-Bold').text('Insurance & Credentials');
                doc.fontSize(10).font('Helvetica').text(letterPrefs.insurance_text, { lineGap: 2 });
                doc.moveDown(0.5);
            }

            // ---------------------------------------------------------------
            // Closing paragraph
            // ---------------------------------------------------------------
            const closingText = letterPrefs.closing_text || 'Thank you for considering my request. I look forward to hearing from you.';
            doc.fontSize(10).font('Helvetica').text(closingText, { align: 'left', lineGap: 2 });
            doc.moveDown(1.5);

            // ---------------------------------------------------------------
            // Signature
            // ---------------------------------------------------------------
            doc.fontSize(10).font('Helvetica').text('Sincerely,');
            doc.moveDown(1);
            if (letterPrefs.signature_name) {
                doc.fontSize(11).font('Helvetica-Bold').text(letterPrefs.signature_name);
            }
            if (letterPrefs.signature_title) {
                doc.fontSize(10).font('Helvetica').text(letterPrefs.signature_title);
            }

            // Contact info in signature
            const sigContact = [letterPrefs.phone, letterPrefs.email].filter(Boolean);
            if (sigContact.length > 0) {
                doc.fontSize(9).font('Helvetica').text(sigContact.join(' | '));
            }

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Generate a signed permission approval PDF.
 * Called after a landowner approves via a permission link.
 * @param {Object} link       - the permission_links row (with signed_name, approved_at, conditions_text, signature_image_path)
 * @param {Object} permission - the permission row (with agency_or_owner, contact fields, site join)
 * @param {Object|null} letterPrefs - the requester's letter_preferences (optional, for formatting)
 * @returns {Promise<Buffer>} PDF file as a Buffer
 */
async function generateSignedPermissionPDF(link, permission, letterPrefs) {
    return new Promise(function (resolve, reject) {
        try {
            const doc = new PDFDocument({
                size: 'LETTER',
                margins: { top: 72, bottom: 72, left: 72, right: 72 },
            });

            const buffers = [];
            const passThrough = new PassThrough();
            passThrough.on('data', function (chunk) { buffers.push(chunk); });
            passThrough.on('end', function () { resolve(Buffer.concat(buffers)); });
            passThrough.on('error', reject);
            doc.pipe(passThrough);

            // ---------------------------------------------------------------
            // APPROVED header
            // ---------------------------------------------------------------
            doc.fontSize(18).font('Helvetica-Bold').fillColor('#2e7d32')
               .text('PERMISSION APPROVED', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(10).font('Helvetica').fillColor('#333333')
               .text('This document confirms that permission has been granted.', { align: 'center' });
            doc.moveDown(1);

            // Horizontal line
            doc.moveTo(72, doc.y).lineTo(540, doc.y).stroke('#cccccc');
            doc.moveDown(1);

            // ---------------------------------------------------------------
            // Permission details
            // ---------------------------------------------------------------
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
               .text('Permission Details');
            doc.moveDown(0.3);
            doc.fontSize(10).font('Helvetica');

            if (permission.agency_or_owner) {
                doc.text('Landowner / Agency: ' + permission.agency_or_owner);
            }
            if (permission.site_name) {
                doc.text('Site: ' + permission.site_name);
            }
            if (permission.site_description) {
                doc.text('Description: ' + permission.site_description);
            }
            if (permission.site_latitude && permission.site_longitude) {
                doc.text('Location: ' + Number(permission.site_latitude).toFixed(4) + ', ' + Number(permission.site_longitude).toFixed(4));
            }
            if (permission.land_type) {
                doc.text('Land Type: ' + permission.land_type);
            }
            doc.moveDown(1);

            // ---------------------------------------------------------------
            // Requester info (from letterPrefs if available)
            // ---------------------------------------------------------------
            if (letterPrefs) {
                doc.fontSize(12).font('Helvetica-Bold').text('Requester');
                doc.moveDown(0.3);
                doc.fontSize(10).font('Helvetica');
                if (letterPrefs.full_name) doc.text('Name: ' + letterPrefs.full_name);
                if (letterPrefs.address) doc.text('Address: ' + letterPrefs.address);
                if (letterPrefs.phone) doc.text('Phone: ' + letterPrefs.phone);
                if (letterPrefs.email) doc.text('Email: ' + letterPrefs.email);
                doc.moveDown(1);
            }

            // ---------------------------------------------------------------
            // Conditions (if any)
            // ---------------------------------------------------------------
            if (link.conditions_text) {
                doc.fontSize(12).font('Helvetica-Bold').text('Conditions');
                doc.moveDown(0.3);
                doc.fontSize(10).font('Helvetica').text(link.conditions_text, { lineGap: 2 });
                doc.moveDown(1);
            }

            // ---------------------------------------------------------------
            // Approval section
            // ---------------------------------------------------------------
            doc.moveTo(72, doc.y).lineTo(540, doc.y).stroke('#cccccc');
            doc.moveDown(1);

            doc.fontSize(12).font('Helvetica-Bold').text('Approval');
            doc.moveDown(0.3);
            doc.fontSize(10).font('Helvetica');
            doc.text('Approved by: ' + (link.signed_name || 'Unknown'));
            const approvedDate = link.approved_at
                ? new Date(link.approved_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            doc.text('Date: ' + approvedDate);
            doc.moveDown(1.5);

            // Signature line
            doc.moveTo(72, doc.y).lineTo(300, doc.y).stroke('#000000');
            doc.moveDown(0.2);
            doc.fontSize(9).font('Helvetica').text(link.signed_name || '', { align: 'left' });
            doc.text('Landowner / Authorized Representative', { align: 'left' });

            doc.moveDown(2);

            // ---------------------------------------------------------------
            // Footer
            // ---------------------------------------------------------------
            doc.fontSize(8).font('Helvetica').fillColor('#888888')
               .text('Generated by Signal Bouncer', { align: 'center' });
            doc.text('Link token: ' + (link.token || '').substring(0, 16) + '...', { align: 'center' });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    generatePermissionLetter: generatePermissionLetter,
    generateSignedPermissionPDF: generateSignedPermissionPDF,
};
