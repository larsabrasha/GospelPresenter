namespace GospelPresenter.Shared.Utils;

public static class EmailValidation
{
    public static bool IsValidEmail(string email)
    {
        var at = email.IndexOf('@');
        if (at < 1) return false;
        var rest = email.Substring(at + 1);
        var dot = rest.IndexOf('.');
        return dot >= 1 && dot < rest.Length - 1;
    }
}
