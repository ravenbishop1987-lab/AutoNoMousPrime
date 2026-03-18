import { supabase } from '../db/supabase.js'

export async function createNotification({
  org_id,
  brand_id = null,
  user_id = null,
  entity_type,
  entity_id,
  notification_type,
  title,
  body = null,
  severity = 'info',
  metadata = {},
}) {
  const { data, error } = await supabase
    .from('in_app_notifications')
    .insert({
      org_id,
      brand_id,
      user_id,
      entity_type,
      entity_id,
      notification_type,
      title,
      body,
      severity,
      metadata,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listNotifications(orgId, userId = null, { unread_only = false } = {}) {
  let query = supabase
    .from('in_app_notifications')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (userId) query = query.or(`user_id.is.null,user_id.eq.${userId}`)
  if (unread_only) query = query.is('read_at', null)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function markNotificationRead(orgId, notificationId) {
  const { data, error } = await supabase
    .from('in_app_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('id', notificationId)
    .select()
    .single()
  if (error) throw error
  return data
}
