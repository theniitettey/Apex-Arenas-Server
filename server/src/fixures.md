// New controller method
async requestOrganizerVerification(req: AuthRequest, res: Response) {
  try {
    const user_id = req.user?.user_id;
    const { id_document_url, business_info } = req.body;

    if (!user_id) {
      return sendUnauthorized(res, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
    }

    const user = await userService.getUserById(user_id);

    if (!user || user.role !== 'organizer') {
      return sendError(res, AUTH_ERROR_CODES.INVALID_ROLE);
    }

    // Store verification request
    await OrganizerVerificationRequest.create({
      user_id,
      id_document_url,
      business_info,
      status: 'pending',
      submitted_at: new Date()
    });

    await AuditService.logAuthEvent({
      user_id,
      event_type: 'organizer_verification_requested',
      success: true,
      metadata: {
        ip_address: req.ip,
        user_agent: req.headers['user-agent']
      }
    });

    return sendSuccess(res, undefined, 'Verification request submitted. An admin will review it shortly.');
  } catch (error: any) {
    logger.error('Organizer verification request error:', error);
    return sendError(res, AUTH_ERROR_CODES.VERIFICATION_FAILED);
  }
}


# Request organizer verification ?? So we create id_url, selfie url, in the db, business info (we need to validate this and not allow any text), status and submitted_at. 

Now the admin has a routeto verify organizers, so admin will have a route to list all requestedorganizer position, then either aprove or reject. 