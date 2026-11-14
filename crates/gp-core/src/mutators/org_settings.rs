// packages/core/src/mutators/org-settings.ts: remote control for the whole organisation.
use super::*;
use super::themes::set_setting;

pub async fn run(name: &str, a: &Obj, ctx: &Ctx) -> Option<R<()>> {
    Some(match name {
        "setRemoteControl" => set_remote_control(a, ctx).await,
        _ => return None,
    })
}

async fn set_remote_control(a: &Obj, ctx: &Ctx) -> R<()> {
    let policy = one_of(a, "policy", &["never", "presenter", "always"])?;
    require(ctx, "ManageOrganizationSettings")?;
    set_setting("remoteControl", &policy).await;
    Ok(())
}
