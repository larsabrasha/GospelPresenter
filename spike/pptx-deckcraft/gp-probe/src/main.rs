//! gp-probe DECK.pptx OUTDIR: every slide at every click, timed.
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).expect("read");
    std::fs::create_dir_all(&a[2]).expect("dir");
    let t = std::time::Instant::now();
    let all = gp_probe::pictures(&bytes, 1.0).expect("import");
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    for (i, step, steps, png) in &all {
        let p = format!("{}/slide-{:02}-click-{step}.png", a[2], i + 1);
        std::fs::write(&p, png).expect("write");
        if *steps > 0 {
            println!("slide {} click {step}/{steps}", i + 1);
        }
    }
    println!("{} pictures of {} slides in {ms:.0} ms", all.len(), all.iter().map(|x| x.0).max().map_or(0, |m| m + 1));
}
