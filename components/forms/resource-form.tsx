'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { submitResource } from '@/lib/community/actions'
import { RESOURCE_FORMATS } from '@/lib/community/constants'
import { initialActionState } from '@/lib/community/types'
import { FieldError, FormStatus, SubmitButton } from '@/components/forms/form-controls'

export function ResourceSubmissionForm() {
  const [state, action] = useActionState(submitResource, initialActionState)
  return (
    <form className="community-form" action={action} noValidate>
      <FormStatus state={state} />
      <fieldset className="form-content">
      <legend className="visually-hidden">Learning resource submission fields</legend>
      <div className="field-grid">
        <label><span className="field-label">Contact email <span aria-hidden="true">*</span></span><input type="email" name="contact_email" autoComplete="email" maxLength={320} required /><FieldError state={state} name="contact_email" /></label>
        <label><span className="field-label">Your name <span className="required-note">Optional</span></span><input type="text" name="submitter_name" autoComplete="name" maxLength={120} /><FieldError state={state} name="submitter_name" /></label>
        <label className="field-group--full"><span className="field-label">Resource title <span aria-hidden="true">*</span></span><input type="text" name="title" maxLength={180} required /><FieldError state={state} name="title" /></label>
        <label className="field-group--full"><span className="field-label">Public URL <span aria-hidden="true">*</span></span><input type="url" name="public_url" inputMode="url" placeholder="https://" required /><span className="field-hint">Public links only. File uploads are not accepted.</span><FieldError state={state} name="public_url" /></label>
        <label><span className="field-label">Material type <span aria-hidden="true">*</span></span><select name="format" defaultValue="" required><option value="" disabled>Select a material type</option>{RESOURCE_FORMATS.map((format) => <option key={format}>{format}</option>)}</select><FieldError state={state} name="format" /></label>
        <label><span className="field-label">Language <span aria-hidden="true">*</span></span><input type="text" name="language" maxLength={80} placeholder="e.g. English, 中文, Spanish" required /><FieldError state={state} name="language" /></label>
        <label className="field-group--full"><span className="field-label">Factual author or publisher <span aria-hidden="true">*</span></span><input type="text" name="author_publisher" maxLength={180} required /><span className="field-hint">This may appear publicly if the resource is published. Your submitter identity will not.</span><FieldError state={state} name="author_publisher" /></label>
        <label className="field-group--full"><span className="field-label">Description <span aria-hidden="true">*</span></span><textarea name="description" maxLength={1000} placeholder="Explain what members can learn about AI agents, who the material is for, and any knowledge they need to get started." required /><FieldError state={state} name="description" /></label>
      </div>
      <fieldset><legend>Confirmations <span aria-hidden="true">*</span></legend><div className="choice-list"><label className="choice"><input type="checkbox" name="access_confirmation" required /><span>I confirm this resource is free and publicly accessible.</span></label><label className="choice"><input type="checkbox" name="copyright_confirmation" required /><span>I have a reasonable basis to share this link and believe the submission does not infringe copyright.</span></label><label className="choice"><input type="checkbox" name="privacy_consent" required /><span>I have read the <Link href="/privacy" target="_blank">Privacy Policy</Link>.</span></label></div><FieldError state={state} name="access_confirmation" /><FieldError state={state} name="copyright_confirmation" /><FieldError state={state} name="privacy_consent" /></fieldset>
      <div className="form-actions"><SubmitButton>Submit resource for review</SubmitButton></div>
      </fieldset>
    </form>
  )
}
