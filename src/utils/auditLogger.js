const { prisma } = require('../config/prisma');

/**
 * Log an action to the audit log
 * @param {Object} params - Audit log parameters
 * @param {String} params.actorType - Type of actor (admin, officer, candidate, voter, system)
 * @param {String} params.actorId - ID of the actor (optional)
 * @param {String} params.action - Action performed (e.g., "CREATE_POSITION", "APPROVE_NOMINATION")
 * @param {String} params.entity - Entity type (e.g., "position", "candidate")
 * @param {String} params.entityId - ID of the entity (optional)
 * @param {Object} params.payload - Additional data (optional)
 */
const logAudit = async ({ actorType, actorId, action, entity, entityId, payload }) => {
  try {
    await prisma.auditLog.create({
      data: {
        actorType,
        actorId: actorId || null,
        action,
        entity: entity || null,
        entityId: entityId || null,
        payload: payload ? JSON.parse(JSON.stringify(payload)) : null
      }
    });
  } catch (error) {
    console.error('Failed to log audit:', error);
    // Don't throw - audit logging failure shouldn't break the app
  }
};

module.exports = { logAudit };

