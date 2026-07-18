namespace AvatarApi.Agents;

public static class PersonaLoader
{
    /// <summary>Reads the persona file, failing with a clear, actionable error if absent/empty.</summary>
    public static string Load(string path)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException(
                $"Persona file not found at '{Path.GetFullPath(path)}'. Set Persona:Path or add persona/persona.md.", path);

        var content = File.ReadAllText(path);
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException($"Persona file '{path}' is empty.");

        return content;
    }
}
