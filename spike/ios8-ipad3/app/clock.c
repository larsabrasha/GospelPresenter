// iOS 8 has no clock_gettime (it came in iOS 10), and Rust's std calls it for Instant (CLOCK_UPTIME_RAW) and
// SystemTime (CLOCK_REALTIME). Defined in the app, it is the one the core's static library links to, on every iOS.
#include <mach/mach_time.h>
#include <sys/time.h>
#include <time.h>

int clock_gettime(int clock, struct timespec *ts) {
    if (clock == 0) {
        // CLOCK_REALTIME: the wall clock.
        struct timeval tv;
        if (gettimeofday(&tv, 0) != 0) return -1;
        ts->tv_sec = tv.tv_sec;
        ts->tv_nsec = tv.tv_usec * 1000;
        return 0;
    }
    // The monotonic clocks: mach_absolute_time in nanoseconds.
    static mach_timebase_info_data_t base;
    if (base.denom == 0) mach_timebase_info(&base);
    unsigned long long ns = mach_absolute_time() * base.numer / base.denom;
    ts->tv_sec = (time_t)(ns / 1000000000ULL);
    ts->tv_nsec = (long)(ns % 1000000000ULL);
    return 0;
}
