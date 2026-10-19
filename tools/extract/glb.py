"""Escritor GLB mínimo (glTF 2.0 binário): nós, malhas com skin, materiais PBR e imagens embutidas."""
import json
import struct

import numpy as np

FLOAT, USHORT, UINT, UBYTE = 5126, 5123, 5125, 5121


class GLB:
    def __init__(self):
        self.j = {'asset': {'version': '2.0', 'generator': 'rust-range extract'}, 'scene': 0, 'scenes': [{'nodes': []}],
                  'nodes': [], 'meshes': [], 'skins': [], 'materials': [], 'textures': [], 'images': [], 'samplers': [],
                  'accessors': [], 'bufferViews': [], 'buffers': []}
        self.bin = bytearray()

    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': len(data)}
        if target:
            v['target'] = target
        self.bin += data
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def accessor(self, arr, ctype, typ, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        a = {'bufferView': self._view(arr.tobytes(), target), 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a['min'] = arr.min(axis=0).tolist()
            a['max'] = arr.max(axis=0).tolist()
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def node(self, **kw):
        self.j['nodes'].append({k: v for k, v in kw.items() if v is not None})
        return len(self.j['nodes']) - 1

    def image(self, data, mime):
        self.j['images'].append({'bufferView': self._view(data), 'mimeType': mime})
        if not self.j['samplers']:
            self.j['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})
        self.j['textures'].append({'source': len(self.j['images']) - 1, 'sampler': 0})
        return len(self.j['textures']) - 1

    def material(self, m):
        self.j['materials'].append(m)
        return len(self.j['materials']) - 1

    def mesh(self, name, pos, nrm, uv, joints, weights, submeshes, materials):
        attrs = {'POSITION': self.accessor(pos.astype(np.float32), FLOAT, 'VEC3', 34962, minmax=True),
                 'NORMAL': self.accessor(nrm.astype(np.float32), FLOAT, 'VEC3', 34962)}
        if uv is not None:
            attrs['TEXCOORD_0'] = self.accessor(uv.astype(np.float32), FLOAT, 'VEC2', 34962)
        if joints is not None:
            attrs['JOINTS_0'] = self.accessor(joints.astype(np.uint16), USHORT, 'VEC4', 34962)
            attrs['WEIGHTS_0'] = self.accessor(weights.astype(np.float32), FLOAT, 'VEC4', 34962)
        prims = []
        for idx, mat in zip(submeshes, materials):
            if len(idx) == 0:
                continue
            p = {'attributes': attrs, 'indices': self.accessor(np.asarray(idx, dtype=np.uint32).reshape(-1), UINT, 'SCALAR', 34963)}
            if mat is not None:
                p['material'] = mat
            prims.append(p)
        self.j['meshes'].append({'name': name, 'primitives': prims})
        return len(self.j['meshes']) - 1

    def skin(self, joints, ibm):
        self.j['skins'].append({'joints': joints, 'inverseBindMatrices': self.accessor(ibm.astype(np.float32), FLOAT, 'MAT4')})
        return len(self.j['skins']) - 1

    def write(self, path, roots):
        self.j['scenes'][0]['nodes'] = roots
        while len(self.bin) % 4:
            self.bin.append(0)
        self.j['buffers'] = [{'byteLength': len(self.bin)}]
        for k in [k for k, v in self.j.items() if isinstance(v, list) and not v]:
            del self.j[k]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))
