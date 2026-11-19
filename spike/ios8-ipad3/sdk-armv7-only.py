# Makes Theos's iPhoneOS9.3.sdk linkable with today's ld, in place: python3 -I sdk-armv7-only.py <the SDK's folder>.
#
# Its .tbd files (format 1) name armv7, armv7s, arm64, i386 and x86_64 under "ios"; today's ld reads the last two as
# the simulator's and refuses the file ("built for 'iOS-simulator'"). Each file keeps armv7 only, and the export
# sections without it go. And libsystem_c's leaves out memcmp, memcpy, memmove, memset and memset_pattern16, which
# the core's library needs, and memchr, strchr, strcmp and strncmp, which SQLite needs: they are added there (the app
# links libSystem, whose libraries dyld searches all of, so which of them names a symbol does not matter on the
# device). Running it twice changes nothing more.
import pathlib, re, sys

ARCHS = re.compile(r'^(\s*(?:- )?archs:\s*)\[([^\]]*)\]')
SECTION = re.compile(r'^(exports|undefineds):\s*$')
MISSING = ['_memcmp', '_memcpy', '_memmove', '_memset', '_memset_pattern16', '_memchr', '_strchr', '_strcmp', '_strncmp']


def armv7_only(text):
    """The file with armv7 alone, or None for one without armv7."""
    out, item, keep, in_section = [], None, True, False

    def flush():
        if item is not None and keep:
            out.extend(item)

    for line in text.split('\n'):
        m = ARCHS.match(line)
        if not in_section:
            if m and not line.startswith(' '):
                if 'armv7' not in [a.strip() for a in m.group(2).split(',')]:
                    return None
                line = m.group(1) + '[ armv7 ]'
            out.append(line)
            in_section = bool(SECTION.match(line))
            item = None
        elif line.startswith('  - '):
            flush()
            keep = 'armv7' in ([a.strip() for a in m.group(2).split(',')] if m else ['armv7'])
            item = [m.group(1) + '[ armv7 ]' if m else line]
        elif line.startswith('    ') and item is not None:
            item.append(line)
        else:
            flush()
            item, in_section = None, bool(SECTION.match(line))
            out.append(line)
    flush()
    return '\n'.join(out)


def with_memory_functions(text):
    """libsystem_c's text with the memory functions in its first export list."""
    absent = [s for s in MISSING if not re.search(rf'[\[ ,]{s}[, \]\n]', text)]
    if not absent:
        return text
    return text.replace('    symbols:            [ ', '    symbols:            [ ' + ', '.join(absent) + ', ', 1)


sdk = pathlib.Path(sys.argv[1])
changed = skipped = 0
for path in sdk.rglob('*.tbd'):
    fixed = armv7_only(path.read_text())
    if fixed is None:
        skipped += 1
        continue
    if path.name == 'libsystem_c.tbd':
        fixed = with_memory_functions(fixed)
    if fixed != path.read_text():
        path.write_text(fixed)
        changed += 1
print(f'{changed} .tbd files changed, {skipped} without armv7 left as they were')
