import type { ComponentProps } from 'react'
import SoftwareAcquisitionForm from './SoftwareAcquisitionForm'
import SoftwareMethodPanel from './SoftwareMethodPanel'

/** Acquisition and annual expense selection share the existing balance draft and save path. */
export default function SoftwareAcquisitionPanel(props: ComponentProps<typeof SoftwareAcquisitionForm>) {
  return <>
    <SoftwareAcquisitionForm {...props} />
    <SoftwareMethodPanel key={props.datasetId} {...props} />
  </>
}
