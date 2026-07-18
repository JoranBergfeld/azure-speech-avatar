using System.IO;
using AvatarApi.Agents;
using Xunit;

namespace Api.Tests;

public class PersonaLoaderTests
{
    [Fact]
    public void Load_returns_file_contents()
    {
        var path = Path.GetTempFileName();
        File.WriteAllText(path, "You are Ada.");
        try
        {
            Assert.Equal("You are Ada.", PersonaLoader.Load(path));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Load_throws_clear_error_when_missing()
    {
        var missing = Path.Combine(Path.GetTempPath(), "does-not-exist-persona.md");
        var ex = Assert.Throws<FileNotFoundException>(() => PersonaLoader.Load(missing));
        Assert.Contains("Persona file not found", ex.Message);
    }
}
