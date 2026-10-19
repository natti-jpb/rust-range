"""Decodifica AnimationClips Mecanim (genéricos) do Unity em trilhas amostradas.

Formato do m_MuscleClip.m_Clip:
  StreamedClip: frames (time f32, n i32, n × (curveIndex i32, coeff 4×f32)); cada chave guarda o
                polinômio cúbico do segmento que começa nela: v(dt) = ((c0·dt + c1)·dt + c2)·dt + c3.
                Primeiro frame em -FLT_MAX (valores iniciais), último em +inf (sentinela).
  DenseClip:    m_SampleArray[frame × curveCount], amostrado em m_SampleRate a partir de m_BeginTime.
  ConstantClip: um valor por curva.
Índices de curva: streamed, depois dense, depois constant. Cada binding de Transform consome 3 curvas
(posição/escala/euler) ou 4 (rotação); os demais consomem 1. binding.path = CRC32 do caminho do
transform relativo ao GameObject do Animator.
"""
import bisect
import math
import struct

import numpy as np


def _streamed_segments(data):
    raw = np.asarray(data, dtype=np.uint32).tobytes()
    curves = {}
    p = 0
    while p < len(raw):
        t, n = struct.unpack_from('<fi', raw, p)
        p += 8
        for _ in range(n):
            idx = struct.unpack_from('<i', raw, p)[0]
            c = struct.unpack_from('<4f', raw, p + 4)
            p += 20
            curves.setdefault(idx, []).append((max(t, -1e30), c))
    return curves


def _eval_segments(segs, t):
    times = [s[0] for s in segs]
    i = max(0, bisect.bisect_right(times, t) - 1)
    t0, (c0, c1, c2, c3) = segs[i]
    dt = 0.0 if t0 < -1e29 else t - t0
    return ((c0 * dt + c1) * dt + c2) * dt + c3


def _curve_count(b):
    if b['typeID'] == 4:
        return 4 if b['attribute'] == 2 else 3 if b['attribute'] in (1, 3, 4) else 1
    return 1


def euler_to_quat(x, y, z):
    """Euler da Unity (graus, ordem ZXY: aplica Z, depois X, depois Y) -> quaternion (x,y,z,w)."""
    x, y, z = (math.radians(v) * 0.5 for v in (x, y, z))
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    # q = qy * qx * qz
    qw = cy * cx * cz + sy * sx * sz
    qx = cy * sx * cz + sy * cx * sz
    qy = sy * cx * cz - cy * sx * sz
    qz = cy * cx * sz - sy * sx * cz
    return qx, qy, qz, qw


def decode_clip(ct, paths, fps=60):
    """ct: typetree do AnimationClip. paths: {crc32: caminho}.
    Devolve {'name', 'duration', 'times', 'tracks': [(caminho, 'position'|'quaternion'|'scale', valores Nx3/Nx4)],
             'events': [(t, função, dado)]}. Coordenadas ainda no espaço da Unity."""
    mc = ct['m_MuscleClip']
    clip = mc['m_Clip']['data']
    start, stop = mc['m_StartTime'], mc['m_StopTime']
    duration = max(stop - start, 1.0 / fps)
    n = max(2, int(round(duration * fps)) + 1)
    times = np.linspace(start, start + duration, n)

    streamed = _streamed_segments(clip['m_StreamedClip']['data'])
    s_count = clip['m_StreamedClip']['curveCount']
    dense = clip['m_DenseClip']
    d_count, d_frames = dense['m_CurveCount'], dense['m_FrameCount']
    d_samples = np.asarray(dense['m_SampleArray'], dtype=np.float32).reshape(max(d_frames, 1), d_count) if d_count else None
    const = clip['m_ConstantClip']['data']

    def curve(idx):
        if idx < s_count:
            segs = streamed.get(idx)
            if not segs:
                return np.zeros(n)
            return np.array([_eval_segments(segs, t) for t in times])
        idx -= s_count
        if idx < d_count:
            f = (times - dense['m_BeginTime']) * dense['m_SampleRate']
            f = np.clip(f, 0, d_frames - 1)
            i0 = np.floor(f).astype(int)
            i1 = np.minimum(i0 + 1, d_frames - 1)
            w = f - i0
            return d_samples[i0, idx] * (1 - w) + d_samples[i1, idx] * w
        idx -= d_count
        return np.full(n, const[idx] if idx < len(const) else 0.0)

    tracks = []
    ci = 0
    for b in ct['m_ClipBindingConstant']['genericBindings']:
        k = _curve_count(b)
        path = paths.get(b['path'])
        if b['typeID'] == 4 and path is not None:
            vals = np.stack([curve(ci + j) for j in range(k)], axis=1)
            if b['attribute'] == 1:
                tracks.append((path, 'position', vals))
            elif b['attribute'] == 2:
                vals /= np.linalg.norm(vals, axis=1, keepdims=True) + 1e-12
                tracks.append((path, 'quaternion', vals))
            elif b['attribute'] == 3:
                tracks.append((path, 'scale', vals))
            elif b['attribute'] == 4:
                tracks.append((path, 'quaternion', np.array([euler_to_quat(*v) for v in vals])))
        ci += k

    events = [(e['time'] - start, e['functionName'], e['data']) for e in ct.get('m_Events', [])]
    return {'name': ct['m_Name'], 'duration': duration, 'times': times - start, 'tracks': tracks, 'events': events,
            'loop': bool(ct.get('m_MuscleClip', {}).get('m_LoopTime', False))}
