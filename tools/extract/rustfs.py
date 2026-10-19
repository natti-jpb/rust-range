"""Acesso aos asset bundles do Rust com resolução preguiçosa de dependências.

Os bundles do Rust são UnityFS sem compressão: cada nó (CAB serializado, .resS, .resource) é uma fatia
contígua do arquivo. Indexamos os cabeçalhos de todos os bundles e só carregamos (via mmap) o CAB que
alguma referência PPtr ou stream de dados pedir.
"""
import glob
import mmap
import os
import struct

import lz4.block
import UnityPy
from UnityPy.streams import EndianBinaryReader


def _cstr(b, i):
    j = b.index(b'\0', i)
    return b[i:j].decode(), j + 1


def bundle_nodes(path):
    """Cabeçalho UnityFS -> (início dos dados, [(offset, tamanho, nome)])."""
    with open(path, 'rb') as f:
        head = f.read(256)
        i = 12
        _, i = _cstr(head, i)
        _, i = _cstr(head, i)
        size, csz, usz, flags = struct.unpack('>qIII', head[i:i + 20])
        i = (i + 20 + 15) // 16 * 16
        f.seek(size - csz if flags & 0x80 else i)
        info = f.read(csz)
    if flags & 0x3F in (2, 3):
        info = lz4.block.decompress(info, uncompressed_size=usz)
    start = i + csz
    if flags & 0x200:
        start = (start + 15) // 16 * 16
    p = 16
    nb = struct.unpack('>i', info[p:p + 4])[0]
    blocks = [struct.unpack('>IIH', info[p + 4 + k * 10:p + 14 + k * 10]) for k in range(nb)]
    if any(b[2] & 0x3F for b in blocks):
        raise ValueError(f'{path}: bundle comprimido')
    p += 4 + nb * 10
    nn = struct.unpack('>i', info[p:p + 4])[0]
    p += 4
    out = []
    for _ in range(nn):
        off, sz, _fl = struct.unpack('>qqI', info[p:p + 20])
        name, p = _cstr(info, p + 20)
        out.append((off, sz, name))
    return start, out


class RustEnv(UnityPy.Environment):
    def __init__(self, rust_dir):
        super().__init__()
        self.index = {}
        self._maps = {}
        for path in glob.glob(os.path.join(rust_dir, 'Bundles', '**', '*.bundle'), recursive=True):
            if os.path.basename(path).startswith('._'):
                continue
            start, ns = bundle_nodes(path)
            for off, sz, name in ns:
                self.index[name.lower()] = (path, start + off, sz, name)

    def _view(self, path, off, sz):
        if path not in self._maps:
            with open(path, 'rb') as f:
                self._maps[path] = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        return memoryview(self._maps[path])[off:off + sz]

    def open(self, name):
        """Carrega um nó pelo nome (CAB-xxx, CAB-xxx.resS, BuildPlayer-...)."""
        key = name.lower()
        if key in self.cabs:
            return self.cabs[key]
        if key not in self.index:
            return None
        path, off, sz, real = self.index[key]
        reader = EndianBinaryReader(self._view(path, off, sz))
        if real.endswith(('.resS', '.resource')):
            self.register_cab(real, reader)
        else:
            self.load_file(reader, name=real)
        return self.cabs.get(key)

    def get_cab(self, name):
        cab = super().get_cab(name)
        if cab is None and os.path.basename(name).lower() in self.index:
            cab = self.open(os.path.basename(name))
        return cab

    def find_file(self, name, is_dependency=True):
        cab = self.get_cab(name)
        if cab is None:
            raise FileNotFoundError(name)
        return cab


def behaviours(sf, script=None, fields=None):
    """MonoBehaviours de um SerializedFile filtrados por nome do script ou por campos do typetree."""
    for pid, o in sf.objects.items():
        if o.type.name != 'MonoBehaviour' or not o.serialized_type or not o.serialized_type.node:
            continue
        names = {c.m_Name for c in o.serialized_type.node.m_Children}
        if fields and not fields <= names:
            continue
        if script:
            try:
                if o.read(check_read=False).m_Script.read().m_ClassName != script:
                    continue
            except Exception:
                continue
        yield pid, o
