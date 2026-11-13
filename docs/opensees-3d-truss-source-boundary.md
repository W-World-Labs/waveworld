# OpenSees 3D truss source boundary

The bounded OpenSees literal 3D truss static work in the sibling W-Sim source
tree is a source-level capability only. WaveWorld does not currently expose an
OpenSees source importer, input editor, job workflow, or result view. Its
released W-Sim dependency remains pinned to `dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`
in both CI and deploy workflows; local W-Sim source changes do not update that
release.

Accordingly, WaveWorld consumers must not advertise or submit OpenSees Tcl
source as supported input through an existing workflow. No WaveWorld payload,
schema, job mapping, or numerical behavior is defined by this source-only work.
The existing OpenSees URL in the STAR-CCM+ catalog is reference material and
does not indicate an OpenSees consumer capability.

Treat source-reader acceptance as a statement about the reader's bounded
literal syntax only. It does not mean WaveWorld can execute the source, that
the released W-Sim pin accepts it, or that OpenSees numerical parity has been
measured. A WaveWorld consumer path would require a separate integration and
release change that establishes its input contract and dispatch behavior.
