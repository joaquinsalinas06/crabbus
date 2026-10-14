// Desktop-only presentation. The hook owns state and drawing; this clock requests its next frame.
export default function CrabClient(props, surface) {
  if (!Number.isFinite(props.ms) || props.ms < 100) throw new Error('Invalid animation interval')
  if (surface.state === undefined) {
    surface.setState({ started: true })
    surface.every(props.ms, () => surface.post({ kind: 'frame' }))
  }
  return {
    type: 'Svg',
    props: { source: props.source, alt: props.alt, width: props.width, height: props.height },
  }
}
