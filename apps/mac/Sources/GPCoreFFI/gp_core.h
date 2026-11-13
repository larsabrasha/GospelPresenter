// The Rust core's C interface (crates/gp-core/src/bridge.rs).
#include <stddef.h>
#include <stdint.h>

/// A buffer the core takes back: pass it to gp_start or gp_resume.
uint8_t *gp_alloc(size_t len);
/// Starts a mutation, {"name","args","ctx"} as JSON. 0 done, 1 refused (the code in out), 2 wants SQL (the request in out).
uint32_t gp_start(uint8_t *ptr, size_t len);
/// The rows of the SQL asked for, a JSON array of arrays; the same answers as gp_start.
uint32_t gp_resume(uint8_t *ptr, size_t len);
const uint8_t *gp_out_ptr(void);
size_t gp_out_len(void);
