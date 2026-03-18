import { supabase } from '../db/supabase.js'
import { getJobValidationState } from './validations.js'
import { getPublishTargetsForJob } from './publishTargets.js'

export async function createJobSnapshot(orgId, job, snapshotType, createdBy = null) {
  if (!job?.id) return null
  const [validationState, publishTargets] = await Promise.all([
    getJobValidationState(orgId, job.id),
    getPublishTargetsForJob(orgId, job.id),
  ])

  const { data, error } = await supabase
    .from('job_snapshots')
    .insert({
      job_id: job.id,
      org_id: orgId,
      brand_id: job.brand_id || null,
      revision_number: job.current_revision_number || 1,
      snapshot_type: snapshotType,
      job_payload: {
        id: job.id,
        topic: job.topic,
        status: job.status,
        job_type: job.job_type,
        input_payload: job.input_payload || {},
        owner_user_id: job.owner_user_id || null,
        review_assignee_user_id: job.review_assignee_user_id || null,
        publish_assignee_user_id: job.publish_assignee_user_id || null,
        waiting_on: job.waiting_on || null,
      },
      publish_payload: publishTargets,
      validation_payload: validationState,
      created_by: createdBy,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listJobSnapshots(orgId, jobId) {
  const { data, error } = await supabase
    .from('job_snapshots')
    .select('*')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
